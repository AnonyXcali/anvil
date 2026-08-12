import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely } from 'kysely';
import type { DB, Json } from 'src/db/db.types';
import { KYSELY_DB } from 'src/tokens';

export type RepairTransactionStatus =
  | 'running'
  | 'completed_with_issues'
  | 'repair_pending'
  | 'repairing'
  | 'completed'
  | 'failed';

export type RepairBugInput = {
  bugKey: string;
  milestoneId?: string;
  milestoneKey?: string;
  severity: string;
  category: string;
  validator: string;
  diagnostic: string;
  affectedFiles: string[];
  originatingRunId: string;
};

export type RepairApprovalCandidate = {
  projectId: string;
  conversationId: string;
  originatingRunId: string;
  transactionId: string;
  bugs: Array<{
    bugKey: string;
    milestoneKey?: string | null;
    severity: string;
    category: string;
  }>;
};

@Injectable()
export class AnvilRepairStateService {
  private readonly logger = new Logger(AnvilRepairStateService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async createTransaction(input: {
    projectId: string;
    conversationId: string;
    originatingRunId: string;
    stagingRoot: string;
    manifestPath: string;
    repairBudget?: number;
  }): Promise<string> {
    const workflowRun = await this.db
      .selectFrom('preview_platform.workflow_run')
      .select('run_id')
      .where('run_id', '=', input.originatingRunId)
      .executeTakeFirst();

    if (!workflowRun) {
      this.logger.error(
        `Cannot create edit transaction: originating workflow run ${input.originatingRunId} was not found`,
      );
      throw new Error(
        `Originating workflow run ${input.originatingRunId} does not exist; refusing to create edit transaction`,
      );
    }

    const row = await this.db
      .insertInto('preview_platform.edit_transaction')
      .values({
        project_id: input.projectId,
        conversation_id: input.conversationId,
        originating_run_id: input.originatingRunId,
        staging_root: input.stagingRoot,
        manifest_path: input.manifestPath,
        repair_budget: input.repairBudget ?? 20,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    this.logger.log(
      `Edit transaction linked to workflow run: ${input.originatingRunId}`,
    );
    return row.id;
  }

  async setTransactionStatus(
    transactionId: string,
    status: RepairTransactionStatus,
  ): Promise<void> {
    await this.db
      .updateTable('preview_platform.edit_transaction')
      .set({ status })
      .where('id', '=', transactionId)
      .execute();
  }

  async incrementRepairAttempt(transactionId: string): Promise<void> {
    await this.db
      .updateTable('preview_platform.edit_transaction')
      .set((eb) => ({
        repair_attempt_count: eb('repair_attempt_count', '+', 1),
      }))
      .where('id', '=', transactionId)
      .execute();
  }

  async claimRepairAttempt(transactionId: string): Promise<number> {
    const row = await this.db
      .updateTable('preview_platform.edit_transaction')
      .set((eb) => ({
        repair_attempt_count: eb('repair_attempt_count', '+', 1),
      }))
      .where('id', '=', transactionId)
      .whereRef('repair_attempt_count', '<', 'repair_budget')
      .returning('repair_attempt_count')
      .executeTakeFirst();
    if (!row) throw new Error(`Repair budget exhausted for ${transactionId}`);
    return row.repair_attempt_count;
  }

  async upsertMilestone(input: {
    transactionId: string;
    milestoneKey: string;
    sequence: number;
    affectedFiles: string[];
    originatingRunId: string;
    status?:
      | 'pending'
      | 'running'
      | 'committed'
      | 'blocked'
      | 'repair_pending'
      | 'failed';
    validationStatus?: string;
    commitStatus?: string;
  }): Promise<string> {
    const affectedFiles = JSON.stringify(input.affectedFiles);
    const row = await this.db
      .insertInto('preview_platform.edit_milestone')
      .values({
        transaction_id: input.transactionId,
        milestone_key: input.milestoneKey,
        sequence: input.sequence,
        affected_files: affectedFiles as unknown as Json,
        originating_run_id: input.originatingRunId,
        status: input.status ?? 'pending',
        validation_status: input.validationStatus ?? 'pending',
        commit_status: input.commitStatus ?? 'pending',
      })
      .onConflict((oc) =>
        oc.columns(['transaction_id', 'milestone_key']).doUpdateSet({
          affected_files: affectedFiles as unknown as Json,
          status: input.status ?? 'pending',
          validation_status: input.validationStatus ?? 'pending',
          commit_status: input.commitStatus ?? 'pending',
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async upsertBug(
    transactionId: string,
    input: RepairBugInput,
  ): Promise<string> {
    let milestoneId = input.milestoneId ?? null;
    if (input.milestoneKey) {
      const milestone = await this.db
        .selectFrom('preview_platform.edit_milestone')
        .select('id')
        .where('transaction_id', '=', transactionId)
        .where('milestone_key', '=', input.milestoneKey)
        .executeTakeFirst();
      if (!milestone) {
        throw new Error(
          `Milestone ${input.milestoneKey} was not found for transaction ${transactionId}`,
        );
      }
      milestoneId = milestone.id;
    }
    const affectedFiles = JSON.stringify(input.affectedFiles);
    const row = await this.db
      .insertInto('preview_platform.edit_bug')
      .values({
        transaction_id: transactionId,
        milestone_id: milestoneId,
        bug_key: input.bugKey,
        severity: input.severity,
        category: input.category,
        validator: input.validator,
        diagnostic: input.diagnostic,
        affected_files: affectedFiles as unknown as Json,
        originating_run_id: input.originatingRunId,
      })
      .onConflict((oc) =>
        oc.columns(['transaction_id', 'bug_key']).doUpdateSet({
          status: 'open',
          diagnostic: input.diagnostic,
          affected_files: affectedFiles as unknown as Json,
          validator: input.validator,
          updated_at: new Date(),
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async resolveBug(transactionId: string, bugKey: string): Promise<void> {
    await this.db
      .updateTable('preview_platform.edit_bug')
      .set({ status: 'resolved', resolved_at: new Date() })
      .where('transaction_id', '=', transactionId)
      .where('bug_key', '=', bugKey)
      .execute();
  }

  async completeRepairTransaction(transactionId: string): Promise<void> {
    await this.db
      .updateTable('preview_platform.edit_bug')
      .set({ status: 'resolved', resolved_at: new Date() })
      .where('transaction_id', '=', transactionId)
      .where('status', 'in', ['open', 'repairing'])
      .execute();
    await this.db
      .updateTable('preview_platform.edit_transaction')
      .set({ status: 'completed', completed_at: new Date() })
      .where('id', '=', transactionId)
      .execute();
  }

  async completeTransaction(transactionId: string): Promise<void> {
    await this.db
      .updateTable('preview_platform.edit_transaction')
      .set({ status: 'completed', completed_at: new Date() })
      .where('id', '=', transactionId)
      .execute();
  }

  async listOpenBugs(transactionId: string) {
    return await this.db
      .selectFrom('preview_platform.edit_bug')
      .selectAll()
      .where('transaction_id', '=', transactionId)
      .where('status', 'in', ['open', 'repairing'])
      .orderBy('created_at', 'desc')
      .execute();
  }

  async getTransaction(transactionId: string) {
    return await this.db
      .selectFrom('preview_platform.edit_transaction')
      .selectAll()
      .where('id', '=', transactionId)
      .executeTakeFirst();
  }

  async findPendingRepairForRun(input: {
    projectId: string;
    conversationId: string;
    originatingRunId: string;
  }): Promise<RepairApprovalCandidate | undefined> {
    const transaction = await this.db
      .selectFrom('preview_platform.edit_transaction')
      .selectAll()
      .where('project_id', '=', input.projectId)
      .where('conversation_id', '=', input.conversationId)
      .where('originating_run_id', '=', input.originatingRunId)
      .where('status', 'in', [
        'completed_with_issues',
        'repair_pending',
        'repairing',
      ])
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    if (!transaction) return undefined;

    const bugs = await this.db
      .selectFrom('preview_platform.edit_bug')
      .leftJoin(
        'preview_platform.edit_milestone',
        'preview_platform.edit_milestone.id',
        'preview_platform.edit_bug.milestone_id',
      )
      .select([
        'preview_platform.edit_bug.bug_key as bugKey',
        'preview_platform.edit_bug.severity as severity',
        'preview_platform.edit_bug.category as category',
        'preview_platform.edit_milestone.milestone_key as milestoneKey',
      ])
      .where('preview_platform.edit_bug.transaction_id', '=', transaction.id)
      .where('preview_platform.edit_bug.status', 'in', ['open', 'repairing'])
      .orderBy('preview_platform.edit_bug.created_at', 'desc')
      .execute();

    if (bugs.length === 0) return undefined;

    return {
      projectId: transaction.project_id,
      conversationId: transaction.conversation_id,
      originatingRunId: transaction.originating_run_id,
      transactionId: transaction.id,
      bugs,
    };
  }

  async createOrReuseRepairApproval(
    candidate: RepairApprovalCandidate,
  ): Promise<{
    approvalId: string;
    created: boolean;
    transactionId: string;
    bugCount: number;
  }> {
    if (candidate.bugs.length === 0) {
      throw new Error(
        `Cannot create repair approval for transaction ${candidate.transactionId}: no open repair bugs`,
      );
    }

    const transaction = await this.db
      .selectFrom('preview_platform.edit_transaction')
      .select([
        'id',
        'project_id',
        'conversation_id',
        'originating_run_id',
        'status',
      ])
      .where('id', '=', candidate.transactionId)
      .where('project_id', '=', candidate.projectId)
      .where('conversation_id', '=', candidate.conversationId)
      .where('originating_run_id', '=', candidate.originatingRunId)
      .where('status', 'in', [
        'completed_with_issues',
        'repair_pending',
        'repairing',
      ])
      .executeTakeFirst();

    if (!transaction) {
      throw new Error(
        `Cannot create repair approval for transaction ${candidate.transactionId}: repair state is not eligible`,
      );
    }

    const runId = `repair:${candidate.transactionId}`;
    const suspendedStep = {
      type: 'repair_approval_required',
      transactionId: candidate.transactionId,
      originatingRunId: candidate.originatingRunId,
      bugCount: candidate.bugs.length,
      bugKeys: candidate.bugs.map((bug) => bug.bugKey),
    } as unknown as Json;

    const inserted = await this.db
      .insertInto('preview_platform.workflow_run')
      .values({
        workflow_id: 'anvil-agent-repair-workflow',
        run_id: runId,
        conversation_id: candidate.conversationId,
        project_id: candidate.projectId,
        status: 'suspended',
        suspended_step: suspendedStep,
        resume_agent_id: null,
        resume_tool_call_id: null,
        resume_tool_name: null,
      })
      .onConflict((oc) => oc.column('run_id').doNothing())
      .returning('id')
      .executeTakeFirst();

    if (inserted) {
      await this.db
        .updateTable('preview_platform.edit_transaction')
        .set({ status: 'repair_pending' })
        .where('id', '=', candidate.transactionId)
        .execute();
      return {
        approvalId: inserted.id,
        created: true,
        transactionId: candidate.transactionId,
        bugCount: candidate.bugs.length,
      };
    }

    const existing = await this.db
      .selectFrom('preview_platform.workflow_run')
      .select('id')
      .where('run_id', '=', runId)
      .executeTakeFirstOrThrow();
    await this.db
      .updateTable('preview_platform.edit_transaction')
      .set({ status: 'repair_pending' })
      .where('id', '=', candidate.transactionId)
      .where('status', 'in', [
        'completed_with_issues',
        'repair_pending',
        'repairing',
      ])
      .execute();
    return {
      approvalId: existing.id,
      created: false,
      transactionId: candidate.transactionId,
      bugCount: candidate.bugs.length,
    };
  }
}

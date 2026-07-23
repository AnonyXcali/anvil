Pre information

- most of the files are already created.
- ask me thoroughly to clear assumptions

REFERENCE - https://mastra.ai/docs, https://github.com/mastra-ai/mastra
IMAGE reference - anvil-edit-agent.png

Initial entry
the flow begins from /src/intent/intent.processor.ts, need to use the anvilSupervisorAgentQueue in anvil-agent-supervisor.service.ts
The queue then invokes the askSupervisorAgent()

Final Implementation

So i want the Supervisor agent to invoke a workflow ‘createFrontendEngineeringWorkflow’.
So it invokes right now based on the query that is provided to it. For example if the user says can you add a form with 3 fields, name, age, address and attach it to the landing page, it just passes that query to the workflow.
The Supervisor agent’s createFrontendEngineeringWorkflow, is specifically designed to do that, or more over specifically to do frontend changes for now.
How it does it work? The workflow is basically broken down in the following steps
Search - this has a search agent which is already built in the platform, it performs an extensive search using a very descriptive instruction of how to perform search in the existing codebase. It basically provides back a response, which contains rich instructions for a file, in different objects for example
For example

{
"is_final":true,
"tool":null,
"final":{
"files_that_require_change":[
{
"file_path":"src/landing/landing-page.component.tsx",
"line_range":{
"startRange":5,
"endRange":5
},
"action_tokens":[
"replace"
],
"precise_instruction":"Replace text 'Hello World' in html element button at line 5 in landing-page.component.tsx, with 'Hey World'",
"code": "<p>Hey World</p>"
},
{
"file_path":"src/landing/landing-page.component.tsx",
"line_range":{
"startRange":10,
"endRange":10
},
"action_tokens":[
"delete"
],
"precise_instruction":"Delete unused variable const auth = new Auth()",
"code": null, //here its null because it gets deleted.
}
]
},
"error":null
}

The next step in the workflow is to go through each of the files_that_require_change objects and create a short description that basically explains in non technical terms what these changes would mean once applied on their application, but in more of business , user experience terms, and not hard technical language.

The above step is called - anvil-agent-workflow-plan-step
and ideally it does the following
it suspends the workflow, expects the user to respond from UI with a button that triggers a post call with a body that basically has a very simple payload to the server. i.e accept or deny
{
decision: ‘accept’ | ‘deny’,
approvalRequestId: string,
}
if accept is provided , the workflow resumes
https://mastra.ai/docs/workflows/suspend-and-resume#restarting-a-workflow-with-resume
It resumes using runId and last step where it was suspended.
if deny is provided, the workflow is terminated

DB integration

- we need to create a new migration where

a project has many conversations, a conversations can have multiple invocations of workflows, hence

CREATE TYPE preview_platform.workflow_job_status as ENUM ('running', 'suspended', 'completed', 'failed', 'cancelled', 'pending');

create table preview_platform.workflow_run (
id uuid primary key default gen_random_uuid(),

    workflow_id text not null,
    run_id text not null unique,

    conversation_id uuid NOT NULL,
    project_id uuid not null,

    status preview_platform.workflow_job_status default 'pending',

    suspended_step jsonb, //store the snapshot

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique(run_id)

    FOREIGN KEY ("conversation_id")
            REFERENCES "preview_platform"."conversation"("id")
            ON UPDATE restrict
            ON DELETE cascade

    FOREIGN KEY ("project_id")
        REFERENCES "preview_platform"."project"("id")
        ON UPDATE restrict
        ON DELETE cascade

);

-- workflow_run updated_at trigger
CREATE TRIGGER "set_preview_platform_workflow_run_updated_at"
BEFORE UPDATE ON "preview_platform"."workflow_run"
FOR EACH ROW
EXECUTE PROCEDURE "preview_platform"."set_current_timestamp_updated_at"();
COMMENT ON TRIGGER "set_preview_platform_workflow_run_updated_at" ON "preview_platform"."workflow_run"
IS 'trigger to set value of column "updated_at" to current timestamp on row update';

so whenever we suspend we store the necessary details from the workflow-execution-suspended event which occurs inside the anvil-supervisor-agent for loop -> switch case.
We then relay a message with structure

{
"type": "approval_required",
"payload": {
"approvalId": "9a4e6d85-...", //this is the id that is returned after saving the necessary details in db.
"title": "Apply proposed changes?",
"message": "The AI has prepared a set of changes that require your approval."
}
}

we won’t be dealing with UI right now, but appearance of this object being relayed is important.

Ideally in parallel, the supervisor agent would be streaming the chunks as we speak.
and the chunk under case 'workflow-execution-suspended', does provide the runId and step’s id to resume it with the user’s intent.
So in that case the supervisor exits and workflow gets suspended, and when the user performs a post call with the approval or denial, it resumes the workflow , and now any chunk being relayed within the workflow using the “this.channelService.publishAndStoreChunk: is published to redis and sent to ui.

Once the user accepts what the non technical change would be.

the next step would be createEditStep - id: anvil-agent-workflow-edit-step.

Here before we invoke the next sub-agent that is ‘anvil-editing-agent’, we need to pass proper structured message for it to process.

{
file_path: string;
line_range: {
startRange: number;
endRange: number;
};
action_tokens: FILE_MODIFICATION_TOKENS[];
precise_instruction: string;
code: string | null;
}

type FILE_MODIFICATION_TOKENS = 'import' | 'add' | 'delete' | 'replace';

we might receive something like -

        "files_that_require_change":[
           {
              "file_path":"src/landing/landing-page.component.tsx",
              "line_range":{
                 "startRange":5,
                 "endRange":5
              },
              "action_tokens":[
                 "replace"
              ],
              "precise_instruction":"Replace text 'Hello World' in html element button at line 5 in landing-page.component.tsx, with 'Hey World'",
              "code": "<p>Hey World</p>"
           },
           {
              "file_path":"src/landing/landing-page.component.tsx",
              "line_range":{
                 "startRange":10,
                 "endRange":10
              },
              "action_tokens":[
                 "delete"
              ],
              "precise_instruction":"Delete unused variable const auth = new Auth()",
              "code": null, //here its null because it gets deleted.
           }
        ]

it needs to be compressed by file_path

export type FILE_EDIT = {
file_path: string;
downloaded_local_file_path: string | null;
instructions: Array<{
line_range: {
startRange: number;
endRange: number;
};
precise_instruction: string;
code: string | null;
verified: boolean;
}>;
error: string;
isEdited: boolean;
hash: string;
}[];

such that

[{
file_path: ‘src/landing/landing-page.component.tsx’;
downloaded_local_file_path: null,
instructions: [{
line_range: {
startRange: 10;
endRange: 5;
};
precise_instruction: “Replace text 'Hello World' in html element button at line 5 in landing-page.component.tsx, with 'Hey World'”;
code: <p>Hey World</p>;
verified: boolean;
},{
line_range: {
startRange: 5;
endRange: 10;
};
precise_instruction: “Delete unused variable const auth = new Auth()”;
code: null;
verified: boolean;
}];
error: string;
isEdited: boolean;
hash: string;
}];

we also need to sort the instruction array in descending order of startRange, so that the edits happened from bottom to top.
Sort each file’s instructions array by startRange descending (bottom-to-top edits).

Now the edit agent has the following set of tools and also supported with a workflow, so to give you an idea

Supervisor agent invokes createFrontendEngineeringWorkflow ->
which performs search, creates instructions, creates a non technical overview post changes, user agrees, goes to editStep, editStep uses an agent, agent has the tools to
create or delete file (if the instruction is straightforward, creating file just creates an empty file, or deletes it, deleting should mostly after the agent verifies that it no longer is required and redundant)
create or delete folder(if the instruction is straightforward, creating folder just creates an empty folder, or deletes it, deleting should mostly after the agent verifies that it no longer is required and redundant and has no files inside)
read file straightforward cat command to read entire file. (token heavy, should be used if context is completely not

If the instructions are pretty clear and no pre-requisite tasks are not required. then the agent should trigger the workflow

the workflow is divided into two parts -

createEditWorkflow()
input : Takes the array of objects that we created in editStep above provided it as stringified JSON to the agent, when the agent decides to invoke createEditWorkflow, the agent must pass the array of objects as it is.
for each object in the array it calls the nested workflow createNestedEditWorkflow().
stateSchema is defined as

export type FILE_EDIT = {
file_path: string;
downloaded_local_file_path: string | null;
instructions: Array<{
line_range: {
startRange: number;
endRange: number;
};
precise_instruction: string;
code: string | null;
}>;
error: string;
isEdited: boolean;
hash: string;
};

export type EDIT_AGENT_INPUT = Array<FILE_EDIT>;

createNestedEditWorkflow(), has the following steps
.then(createDownloadStep())
.then(createGeneratedBackupStep())
.foreach(createApplyEditStep())
// .then(createVerifyStep()) //use agent check with precise instruction and compares file content,
// if wrong update precise instruction, with update line numbers and call edit tool again,
// if correct update then move to upload
// .then(createUploadFileStep())
// .then(createHashCheckStep())
// .then(createDeleteStep())

createDownloadStep() receives the object and downloads from the path provided.
ssh.service.ts has a method called ‘downloadProjectFile’
need to introduce a tool in mastra, that invokes the tool via anvil-agent-edit.service.ts -> downloadFile() -> which calls the SSH method.
in the method also calculate the hash, return hash.
we use setState method provisioned by the available Context Object via execute method.
setState method is used to update the stateSchema with downloaded_local_file_path and also update the hash.

returns { file_path: string } for the next step as output Schema

createGeneratedBackupStep()

this step receives an object simply { file_path: sting }
need to invoke a tool
ssh.service.ts has backupProjectFile( projectId: string,
filePath: string)
need to introduce a tool in mastra, that invokes the tool via anvil-agent-edit.service.ts -> createBackupFile() -> calls backupProjectFile internally.
updates the state.backup_file with the returned file name.

retrieves the instructions key from the state which is an array and passes to the next step i.e createEditStep()

createEditStep()

since its a foreach method from mastra as next step, this step iterates over the INSTRUCTIONS array, that contains individual changes, and performs the edit

method resides in anvil-agent-edit.service.ts, which is named as edit(), which receives the path as mentioned in downloaded_local_file_path, also the exact code, start and end range.
gets the content of the file, and splits them into an array separated by new line
performs the edit on the indexes as mentioned in the start and end range.
basically replaces the content in those line ranges with the exact code as provided.
Ideally at the end of going over each object the entire file should now be as the instructions intended.

Hence to verify that we would go to the next step that is verify.

createVerifyStep()

read file with precise instruction -> verified -> done
|
V
if not verified generate instructions to fix. -> repeat

this step receives individual objects similar to edit step.
we invoke a verify agent (need to create it) here that is strictly responsible to just look at the precise instruction, code key and read the content of the local file from the provided file path via parameter and confirm that the change exists.

the agent should respond with structured response

{
verified: boolean,
fix_instruction: {
file_path: string; //path of the local file
line_range: {
startRange: number;
endRange: number;
}
}

verified true - in case of exact match found in the file which matches the precise instruction. //this is the exit condition for the do while loop
verified: false, update fix_instruction with exact line numbers and change.
the agent must be strictly advised to make sure that the changes should not affect the line before startRange.
Any changes must happen AFTER the startRange to preserve line numbers.
we invoke the edit() method from anvil-agent-edit.service.ts and modify it, and ask the agent to read it again.
so ‘do while’ loop run until agent responds with verified, we would make this run maximum 5 times, and even if after 5 times it gives verified: false, we end the workflow, and throw error. (we should call delete to perform garbage collection, and send a chunk to user that something went wrong)
when verified response arrives, we update the input INSTRUCTION with
concatenate precise instruction with fix_instruction.
update startRange and endRange with changes in fix_instruction.line_range if any.
verified to true.
return the updated INSTRUCTION object

this happens for all the objects, the guardrail is that if something happens the original file does not change.

If successfully the file changes, we move to the next step that is upload file.
the tool receives the following params
original file path
local modified file path
this should invoke the tool which calls the upload() method from anvil-agent-edit.service.ts
the upload method should call the ssh service which performs the following
takes the local file with new changes
parse the folder where the original file is residing
use that path to set the target destination
upload the file to target destination same as the original file_path, basically replacing the file there.

returns for each successful step
{
success: true,
file_path: path of the original file.
}

And now finally

createDeleteStep() this is the garbage collection, its a foreach step where it receives
array of objects contain
{
backupFilePath: item.backup_file,
localFilePath: item.downloaded_local_file_path,
}
the step invokes a tool, it receives the following params
backupFilePath, backup file path
localFilePath, local modified file path
this should invoke the tool which calls the cleanUp() method from anvil-agent-edit.service.ts

it has two distinct methods

deletes the back up file in the remote destination -> calls a service in ssh.service.ts file called deleteProjectFile
deletes the local file, implementation is there itself.
deletes the local file as provided in parameter localFilePath.

NOTE: None of the tools are created, we need to create the tools and invoke them as instructed.

(() => {
  document.querySelectorAll('[data-auth-action]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = form.parentElement?.querySelector('[data-auth-result]');
      const submit = form.querySelector('button[type="submit"]');
      const originalLabel = submit?.innerHTML;
      if (submit) {
        submit.disabled = true;
        submit.innerHTML = 'Working…';
      }
      try {
        const response = await fetch(form.dataset.authAction, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        window.location.href = '/testing';
      } catch (error) {
        if (result)
          result.textContent = `Authentication failed: ${error.message}`;
        if (submit) {
          submit.disabled = false;
          submit.innerHTML = originalLabel || 'Continue';
        }
      }
    });
  });
  document.querySelectorAll('[data-copy-text]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.querySelector('#query');
      if (!(input instanceof HTMLTextAreaElement)) return;
      input.value = button.dataset.copyText || '';
      input.focus();
    });
  });
  const root = document.querySelector('[data-conversation-id]');
  if (!root) return;

  const state = {
    conversationId: root.dataset.conversationId,
    streamUrl: root.dataset.streamUrl,
    source: null,
    activeMessageId: null,
    approvalToMessage: new Map(),
    composers: new Map(),
    lastSequenceByStream: new Map(),
  };
  const transcript = document.getElementById('transcript');
  const timeline = document.getElementById('timeline');
  const debugOutput = document.getElementById('debug-output');
  const connectionState = document.getElementById('connection-state');
  const requestLog = document.getElementById('request-log');
  const approvalPanel = document.getElementById('approval-panel');
  const approvalContent = document.getElementById('approval-content');
  const sendButton = document.getElementById('send-button');
  const defaultApprovalMessage =
    'The AI has prepared a set of changes that require your approval.';

  function setConnectionState(label, stateName) {
    if (!connectionState) return;
    connectionState.dataset.state = stateName;
    const labelTarget = connectionState.querySelector('.connection-label');
    if (labelTarget) labelTarget.textContent = label;
    else connectionState.textContent = label;
  }

  const escapeHtml = (value) =>
    String(value ?? '').replace(
      /[&<>'"]/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#039;',
          '"': '&quot;',
        })[char],
    );

  function log(message, detail) {
    const row = document.createElement('div');
    row.textContent = `${new Date().toLocaleTimeString()} ${message}${detail ? ` ${detail}` : ''}`;
    requestLog?.prepend(row);
  }

  function extractPreviewUrl(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/\bhttps?:\/\/[^\s<>"')]+/i);
    if (!match) return null;

    try {
      const url = new URL(match[0]);
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? url.href
        : null;
    } catch {
      return null;
    }
  }

  function makeMessageId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function ensureComposer(messageId, streamId) {
    let composer = state.composers.get(messageId);
    if (!composer) {
      composer = {
        messageId,
        streamId,
        text: '',
        status: 'running',
        timeline: [],
        activity: null,
        previewUrl: null,
        approvalMessage: null,
      };
      state.composers.set(messageId, composer);
      const card = document.createElement('article');
      card.className = 'chat-card chat-assistant';
      card.dataset.messageId = messageId;
      card.hidden = true;
      card.innerHTML = `<div class="chat-meta">assistant · ${escapeHtml(messageId.slice(0, 8))}</div><div class="chat-content"></div><div class="chat-activity" hidden></div><div class="chat-actions" hidden></div>`;
      transcript?.append(card);
    }
    if (streamId) composer.streamId = streamId;
    return composer;
  }

  function messageForStream(streamId) {
    if (streamId) {
      for (const composer of state.composers.values()) {
        if (composer.streamId === streamId) return composer;
      }
      const activeComposer = state.activeMessageId
        ? state.composers.get(state.activeMessageId)
        : null;
      if (activeComposer && !activeComposer.streamId) {
        activeComposer.streamId = streamId;
        return activeComposer;
      }
      return ensureComposer(makeMessageId(), streamId);
    }
    return state.activeMessageId
      ? ensureComposer(state.activeMessageId, streamId)
      : null;
  }

  function renderComposer(composer) {
    const card = transcript?.querySelector(
      `[data-message-id="${CSS.escape(composer.messageId)}"]`,
    );
    if (!card) return;
    const content = card.querySelector('.chat-content');
    const activity = card.querySelector('.chat-activity');
    const actions = card.querySelector('.chat-actions');
    const visibleText = composer.text || composer.approvalMessage || '';
    const hasActivity = Boolean(composer.activity?.active);
    const hasActions = Boolean(composer.previewUrl);
    card.hidden = !visibleText && !hasActivity && !hasActions;
    if (content) content.textContent = visibleText;
    if (activity) {
      const currentActivity = composer.activity;
      if (currentActivity?.active) {
        activity.hidden = false;
        activity.innerHTML = `<span class="activity-dot" aria-hidden="true"></span><span>${escapeHtml(currentActivity.label)}</span>`;
        activity.dataset.kind = currentActivity.kind;
      } else {
        activity.hidden = true;
        activity.textContent = '';
        delete activity.dataset.kind;
      }
    }
    if (actions) {
      if (composer.previewUrl) {
        actions.hidden = false;
        actions.innerHTML = `<a class="button button-quiet preview-link" href="${escapeHtml(composer.previewUrl)}" target="_blank" rel="noopener noreferrer">Open preview</a>`;
      } else {
        actions.hidden = true;
        actions.textContent = '';
      }
    }
    card.dataset.status = composer.status;
  }

  function activityForEvent(type, payload) {
    // Status events drive the transient assistant activity indicator. Approval,
    // completion, error, and text events are handled by handleEvent below.
    const activeStatuses = new Set(['started', 'running']);
    const inactiveStatuses = new Set([
      'completed',
      'failed',
      'cancelled',
      'suspended',
    ]);
    const status = payload.status;

    if (inactiveStatuses.has(status)) {
      return null;
    }

    if (!activeStatuses.has(status)) {
      return undefined;
    }

    const fallbackLabels = {
      workflow_status: { kind: 'thinking', label: 'Planning workflow...' },
      search_status: { kind: 'thinking', label: 'Thinking through files...' },
      edit_status: { kind: 'editing', label: 'Editing project files...' },
      tool_status: { kind: 'tool', label: 'Using a tool...' },
      verification_status: { kind: 'verifying', label: 'Verifying changes...' },
    };
    const fallback = fallbackLabels[type];

    if (!fallback) {
      return undefined;
    }

    return {
      kind: fallback.kind,
      label: payload.message || fallback.label,
      active: true,
    };
  }

  function completionMessageForEvent(type, payload, message) {
    if (type === 'completed' || type === 'workflow-resume-completed') {
      return message || 'The requested change is finished.';
    }

    if (type === 'workflow_status' && payload.status === 'completed') {
      return message || 'The requested change is finished.';
    }

    return null;
  }

  function renderTimeline(composer, type, message) {
    if (!timeline) return;
    if (timeline.querySelector('.empty-state')) timeline.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'timeline-row';
    row.innerHTML = `<strong>${escapeHtml(type)}</strong><span>${escapeHtml(message)}</span>`;
    timeline.prepend(row);
    while (timeline.children.length > 200) timeline.lastElementChild?.remove();
    composer.timeline.push({ type, message });
  }

  function showApproval(composer, payload) {
    if (!approvalContent) return;
    const approvalId = payload?.approvalId;
    if (!approvalId) return;
    state.approvalToMessage.set(approvalId, composer.messageId);
    composer.approvalMessage = payload.message || defaultApprovalMessage;
    if (approvalPanel) approvalPanel.hidden = false;
    approvalContent.innerHTML = `<div class="approval-card"><strong>${escapeHtml(payload.title || 'Approval required')}</strong><p>${escapeHtml(payload.message || 'The workflow is waiting for a decision.')}</p>${payload.summary ? `<p class="muted">${escapeHtml(payload.summary)}</p>` : ''}<div class="form-actions"><button class="button button-primary" data-decision="accept">Accept</button><button class="button" data-decision="deny">Deny</button></div></div>`;
    renderComposer(composer);
    approvalContent.querySelectorAll('[data-decision]').forEach((button) => {
      button.addEventListener('click', async () => {
        approvalContent.querySelectorAll('button').forEach((item) => {
          item.disabled = true;
        });
        log('approval decision sent', button.dataset.decision);
        try {
          const response = await fetch('/core/decision', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              decision: button.dataset.decision,
              approvalRequestId: approvalId,
            }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          approvalContent.textContent = 'No approval is waiting.';
          if (approvalPanel) approvalPanel.hidden = true;
        } catch (error) {
          approvalContent.innerHTML = `<p class="empty-state">Decision failed: ${escapeHtml(error.message)}</p>`;
        }
      });
    });
  }

  function unwrap(raw) {
    let value = raw;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return { type: 'legacy-text', payload: { message: value } };
      }
    }
    if (value && typeof value.chunk === 'string') {
      const outer = value;
      let chunk = outer.chunk;
      try {
        chunk = JSON.parse(chunk);
      } catch {
        chunk = { type: 'legacy-text', payload: { message: outer.chunk } };
      }
      if (
        chunk?.raw &&
        typeof chunk.raw === 'object' &&
        chunk.raw.type === chunk.type
      ) {
        return {
          ...chunk.raw,
          streamId: outer.streamId,
          seq: outer.seq,
          rawEnvelope: outer,
          debugEnvelope: chunk,
        };
      }
      return {
        ...chunk,
        streamId: outer.streamId,
        seq: outer.seq,
        rawEnvelope: outer,
      };
    }
    return value || {};
  }

  function shouldIgnoreSequence(event) {
    if (!event.seq) return false;

    const sequenceKey = event.streamId || 'legacy';
    const lastSeq = state.lastSequenceByStream.get(sequenceKey) || 0;

    if (event.seq <= lastSeq) return true;

    state.lastSequenceByStream.set(sequenceKey, event.seq);
    return false;
  }

  function handleEvent(raw) {
    // The SSE contract carries either raw text deltas or application events.
    // Application event types control chat UI actions such as activity state,
    // approval controls, completion, and error presentation.
    const event = unwrap(raw);
    const streamId = event.streamId;
    if (shouldIgnoreSequence(event)) return;
    const rawEnvelope = event.rawEnvelope || event.raw || event;
    if (debugOutput && rawEnvelope) {
      const line = JSON.stringify(rawEnvelope, null, 2);
      debugOutput.textContent =
        debugOutput.textContent === 'No raw envelopes received.'
          ? line
          : `${line}\n\n${debugOutput.textContent}`;
      const lines = debugOutput.textContent.split('\n');
      if (lines.length > 1200)
        debugOutput.textContent = lines.slice(0, 1200).join('\n');
    }
    const approvalId = event.payload?.approvalId;
    const mappedMessageId = approvalId
      ? state.approvalToMessage.get(approvalId)
      : null;
    const composer = mappedMessageId
      ? state.composers.get(mappedMessageId)
      : messageForStream(streamId);
    if (!composer) return;
    if (streamId && !composer.streamId) composer.streamId = streamId;
    const type = event.type || 'event';
    const payload = event.payload || event.data || {};
    const message =
      payload.message || payload.text || payload.result || event.message || '';
    if (type === 'text-delta' || type === 'text')
      composer.text += typeof message === 'string' ? message : '';
    const previewUrl = extractPreviewUrl(message);
    if (previewUrl) composer.previewUrl = previewUrl;
    const nextActivity = activityForEvent(type, payload);
    if (nextActivity !== undefined) composer.activity = nextActivity;
    const completionMessage = completionMessageForEvent(type, payload, message);
    if (completionMessage && !composer.text) {
      composer.text = completionMessage;
      composer.activity = null;
    }
    if (
      type === 'workflow_status' ||
      type === 'search_status' ||
      type === 'edit_status' ||
      type === 'tool_status' ||
      type === 'verification_status' ||
      type === 'approval_required' ||
      type === 'completed' ||
      type === 'error' ||
      type === 'legacy-text'
    ) {
      renderTimeline(
        composer,
        type,
        message ||
          (type === 'completed' ? 'Workflow completed.' : 'Event received.'),
      );
    }
    if (type === 'approval_required') showApproval(composer, payload);
    if (type === 'completed' || type === 'workflow-resume-completed')
      composer.status = 'completed';
    if (type === 'error' || type === 'workflow-resume-cancelled')
      composer.status = 'error';
    renderComposer(composer);
  }

  function connect() {
    if (state.source) return;
    setConnectionState('Connecting', 'connecting');
    state.source = new EventSource(state.streamUrl);
    state.source.onopen = () => {
      setConnectionState('Connected', 'connected');
      log('SSE connected');
    };
    state.source.onmessage = (event) => {
      try {
        handleEvent(event.data);
      } catch (error) {
        log('stream parse failure', error.message);
      }
    };
    state.source.onerror = () => {
      const reconnecting = state.source?.readyState === EventSource.CONNECTING;
      setConnectionState(
        reconnecting ? 'Reconnecting' : 'Error',
        reconnecting ? 'reconnecting' : 'error',
      );
      log('SSE connection error');
    };
  }

  function reset() {
    state.source?.close();
    state.source = null;
    state.composers.clear();
    state.activeMessageId = null;
    state.lastSequenceByStream.clear();
    if (timeline)
      timeline.innerHTML =
        '<p class="empty-state">Waiting for stream events.</p>';
    if (debugOutput) debugOutput.textContent = 'No raw envelopes received.';
    if (approvalPanel) approvalPanel.hidden = true;
    if (approvalContent)
      approvalContent.textContent = 'No approval is waiting.';
    setConnectionState('Disconnected', 'disconnected');
  }

  document.getElementById('reset-stream')?.addEventListener('click', reset);
  document.querySelectorAll('[data-project-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.projectAction;
      const projectId = button.dataset.projectId;
      const logTarget = document.getElementById('project-job-log');
      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = 'Working…';
      try {
        const response = await fetch(
          `/testing/projects/${projectId}/${action}`,
          { method: 'POST' },
        );
        const job = await response.json();
        if (!response.ok)
          throw new Error(job.message || `HTTP ${response.status}`);
        if (logTarget) logTarget.textContent = `Job ${job.job_id} queued.`;
        log(`project ${action} requested`, job.job_id);
        if (job.job_id) {
          const poll = async () => {
            const statusResponse = await fetch(
              `/testing/projects/${projectId}/jobs/${job.job_id}`,
            );
            const status = await statusResponse.json().catch(() => null);
            if (!statusResponse.ok || !status || !status.state) {
              if (logTarget) logTarget.textContent = 'Job status unavailable.';
              log('project job status unavailable', job.job_id);
              return;
            }
            if (logTarget)
              logTarget.textContent = `Job status: ${status.state}`;
            if (status.state === 'queued' || status.state === 'active')
              window.setTimeout(poll, 1200);
          };
          await poll();
        }
      } catch (error) {
        if (logTarget)
          logTarget.textContent = `Project action failed: ${error.message}`;
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });
  });
  document
    .querySelector('[data-project-rename]')
    ?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const response = await fetch(form.action, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: form.querySelector('[name="name"]').value,
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        log('project renamed');
        window.location.reload();
      } catch (error) {
        log('project rename failed', error.message);
      }
    });
  document
    .querySelector('[data-project-delete]')
    ?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (!window.confirm('Delete this project? It must be stopped first.'))
        return;
      button.disabled = true;
      try {
        const response = await fetch(
          `/testing/projects/${button.dataset.projectId}`,
          {
            method: 'DELETE',
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        window.location.href = '/testing';
      } catch (error) {
        button.disabled = false;
        log('project delete failed', error.message);
      }
    });
  document
    .getElementById('message-form')
    ?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const input = form.querySelector('textarea');
      const query = input.value.trim();
      if (!query) return;
      const messageId = makeMessageId();
      state.activeMessageId = messageId;
      const userCard = document.createElement('article');
      userCard.className = 'chat-card chat-user';
      userCard.innerHTML = `<div class="chat-meta">user</div><div class="chat-content">${escapeHtml(query)}</div>`;
      transcript?.append(userCard);
      ensureComposer(messageId);
      input.value = '';
      sendButton.disabled = true;
      const originalSendLabel = sendButton.innerHTML;
      sendButton.innerHTML = 'Sending…';
      log('message submitted', messageId);
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ query }),
        });
        if (!response.ok && response.type !== 'opaqueredirect')
          throw new Error(`HTTP ${response.status}`);
        const result = await response.json().catch(() => null);
        if (result?.stream_id) {
          ensureComposer(messageId, result.stream_id);
        }
      } catch (error) {
        log('message submission failed', error.message);
      }
      sendButton.disabled = false;
      sendButton.innerHTML = originalSendLabel;
    });
  connect();
})();

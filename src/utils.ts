function extractCode(input: string): string {
  const match = input.match(
    /```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)```/i,
  );

  return (match?.[1] ?? input).trim();
}

function extractCode_v2(input: string): string {
  const match = input.match(
    /```(?:tsx|typescript|ts|jsx|javascript|js)?\s*([\s\S]*?)```/i,
  );
  return (match?.[1] ?? input).trim();
}

function generateKeys(conversationId: string, jobId: string) {
  const baseKey = `conversation:${conversationId}:job:${jobId}`;
  const seqKey = `${baseKey}:seq`;
  const listKey = `${baseKey}:chunks`;
  const metaKey = `${baseKey}:meta`;
  const channelKey = conversationId;

  return {
    seqKey,
    listKey,
    metaKey,
    channelKey,
  };
}

function buildRegexPattern(patterns: string[]): string {
  return patterns.join('|');
}

export { extractCode, extractCode_v2, generateKeys, buildRegexPattern };

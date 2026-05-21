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

export { extractCode, extractCode_v2 };

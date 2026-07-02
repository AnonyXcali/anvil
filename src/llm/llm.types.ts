export interface LLM {
  chat(query: string): Promise<string>;
}

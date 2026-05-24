import { Controller } from '@nestjs/common';

//harness engineering: https://www.youtube.com/watch?v=C_GG5g38vLU
@Controller('llm')
export class LlmController {
  // @Post()
  // async chatTest(@Body() body: { message: string }): Promise<string> {
  //   const rawCode = await this.llmService.chat(body.message);
  //
  //   if (!rawCode) throw new Error('No code was returned');
  //   const extractedCode = extractCode_v2(rawCode);
  //   console.log(extractedCode);
  //   return 'Test';
  // }

  // @Post()
  // async chat(@Body() body: { message: string }) {
  //   const rawCode = await this.llmService.chat(body.message);
  //   if (!rawCode) return 'no code was generated';
  //   const code = extractCode(rawCode);
  //   const encodedCode = Buffer.from(code, 'utf8').toString('base64');
  //   const filePath = `/tmp/llm-code-${Date.now()}.js`;
  //   const command = `
  //   echo '${encodedCode}' | base64 -d > ${filePath}
  //   node ${filePath}
  //   rm ${filePath}
  //   `.trim();
  //   const res = await this.sshService.runCommand(command);
  //   return res;
  // }
}

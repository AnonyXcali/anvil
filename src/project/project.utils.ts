export class ProjectUtils {
  static generateProjectJobId(jobId: string, type: string) {
    return `${type}:${jobId}`;
  }
}

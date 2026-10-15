declare module "mammoth" {
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: { type: string; message: string }[] }>;
  };
  export default mammoth;
}

export {};

declare global {
  interface Window {
    DCBackend: {
      callBackend: (methodName: string, args: Record<string, any>) => Promise<any>;
    };
  }
}

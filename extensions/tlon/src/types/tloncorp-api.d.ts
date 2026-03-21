declare module "@tloncorp/api" {
  export function configureClient(options: {
    shipUrl: string;
    shipName: string;
    verbose?: boolean;
    getCode: () => string | Promise<string>;
  }): void;

  export function uploadFile(options: {
    blob: Blob;
    fileName: string;
    contentType: string;
  }): Promise<{ url: string }>;
}

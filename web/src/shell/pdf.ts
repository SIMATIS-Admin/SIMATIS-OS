// Lecture du PDF d'un deck dans le navigateur (pdf.js, chargé seulement pour présenter).
export type PagePdfLue = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};
export type DocPdf = { numPages: number; getPage: (n: number) => Promise<PagePdfLue> };

export async function chargerPdf(url: string): Promise<DocPdf> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return (await pdfjs.getDocument({ url }).promise) as unknown as DocPdf;
}

import { waitForGlobal, waitForPaint } from "./utils.js";

let workerPromise = null;
let activeProgress = null;
let pdfWorkerConfigured = false;

function configurePdfJs(pdfjs) {
    if (pdfWorkerConfigured) return;

    pdfjs.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

    pdfWorkerConfigured = true;
}

async function getOcrWorker() {
    if (!workerPromise) {
        const Tesseract = await waitForGlobal("Tesseract");

        workerPromise = Tesseract.createWorker("por+eng", 1, {
            workerPath:
                "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
            corePath:
                "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0",
            langPath:
                "https://tessdata.projectnaptha.com/4.0.0",
            logger(event) {
                if (
                    event.status === "recognizing text" &&
                    typeof event.progress === "number" &&
                    activeProgress
                ) {
                    activeProgress(
                        Math.round(event.progress * 100),
                        "Reconhecendo texto da página..."
                    );
                }
            }
        }).catch((error) => {
            workerPromise = null;
            throw error;
        });
    }

    return workerPromise;
}

function normalizeRecognizedText(value, font) {
    let text = String(value || "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

    if (!text) return "";

    try {
        font.encodeText(text);
        return text;
    } catch {
        text = text
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/[–—]/g, "-")
            .replace(/…/g, "...")
            .normalize("NFKC")
            .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();

        try {
            font.encodeText(text);
            return text;
        } catch {
            return text.replace(/[^\x20-\x7E]/g, " ").trim();
        }
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function mapBoxToPdf(viewport, box) {
    // Converte os quatro cantos para suportar coordenadas de página
    // em orientações diferentes.
    const points = [
        viewport.convertToPdfPoint(box.x0, box.y0),
        viewport.convertToPdfPoint(box.x1, box.y0),
        viewport.convertToPdfPoint(box.x0, box.y1),
        viewport.convertToPdfPoint(box.x1, box.y1)
    ];

    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);

    return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys)
    };
}

function fitWordToBox(text, font, box) {
    const height = clamp(box.height, 4, 60);
    const width = clamp(box.width, 2, 700);

    let fontSize = clamp(height * 1.02, 4, 32);
    let naturalWidth = Math.max(
        0.1,
        font.widthOfTextAtSize(text, fontSize)
    );

    let ratio = width / naturalWidth;

    // Ajusta o tamanho quando a palavra detectada for muito
    // estreita ou muito larga em relação à fonte incorporada.
    if (ratio < 0.68 || ratio > 1.42) {
        fontSize = clamp(
            fontSize * clamp(ratio, 0.68, 1.42),
            3.5,
            32
        );

        naturalWidth = Math.max(
            0.1,
            font.widthOfTextAtSize(text, fontSize)
        );

        ratio = width / naturalWidth;
    }

    let characterSpacing = 0;

    if (text.length > 1 && ratio >= 0.68 && ratio <= 1.42) {
        characterSpacing =
            (width - naturalWidth) / (text.length - 1);

        characterSpacing = clamp(
            characterSpacing,
            -fontSize * 0.12,
            fontSize * 0.18
        );
    }

    return {
        fontSize,
        characterSpacing
    };
}

function drawInvisibleWord(page, font, rawWord, rawBox) {
    const box = rawBox?.box;
    const viewport = rawBox?.viewport;

    if (!box || !viewport || !rawWord) return;

    if (typeof rawWord.text !== "string") return;
    if (typeof box.x0 !== "number" || typeof box.x1 !== "number") return;
    if (typeof box.y0 !== "number" || typeof box.y1 !== "number") return;

    const text = normalizeRecognizedText(rawWord.text, font);

    if (!text) return;

    // Descarta pequenas manchas que geralmente correspondem
    // a falsos reconhecimentos.
    if (
        typeof rawWord.confidence === "number" &&
        rawWord.confidence < 8
    ) {
        return;
    }

    const position = mapBoxToPdf(viewport, box);

    if (
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !Number.isFinite(position.width) ||
        !Number.isFinite(position.height)
    ) {
        return;
    }

    const crop = page.getCropBox();

    const x = clamp(
        position.x,
        crop.x,
        crop.x + crop.width
    );

    const yBottom = clamp(
        position.y,
        crop.y,
        crop.y + crop.height
    );

    const width = Math.min(
        position.width,
        crop.x + crop.width - x
    );

    const height = Math.min(
        position.height,
        crop.y + crop.height - yBottom
    );

    if (width < 1 || height < 2) return;

    const { fontSize, characterSpacing } = fitWordToBox(
        text,
        font,
        { width, height }
    );

    // Ajusta a linha de base para dentro da caixa reconhecida.
    const baselineY = clamp(
        yBottom + height * 0.17,
        crop.y,
        crop.y + crop.height
    );

    page.drawText(text, {
        x,
        y: baselineY,
        size: fontSize,
        font,
        characterSpacing,
        opacity: 0,
        lineHeight: fontSize
    });
}

export async function makePdfSearchable(
    inputBytes,
    fileName = "documento.pdf",
    onProgress = () => {}
) {
    const PDFLib = await waitForGlobal("PDFLib");
    const pdfjs = await waitForGlobal("pdfjsLib");

    configurePdfJs(pdfjs);

    const bytes = inputBytes instanceof Uint8Array
        ? inputBytes.slice()
        : new Uint8Array(inputBytes);

    let loadingTask;
    let pdfDocument;

    try {
        onProgress(2, `Analisando ${fileName}...`);

        loadingTask = pdfjs.getDocument({
            data: bytes.slice()
        });

        pdfDocument = await loadingTask.promise;

        const scannedPages = [];

        for (
            let pageNumber = 1;
            pageNumber <= pdfDocument.numPages;
            pageNumber++
        ) {
            const page = await pdfDocument.getPage(pageNumber);
            const content = await page.getTextContent();

            const existingText = content.items
                .filter((item) => typeof item.str === "string")
                .map((item) => item.str.trim())
                .filter(Boolean)
                .join(" ");

            // Páginas com pouco texto são candidatas a digitalizações.
            if (existingText.length < 35) {
                scannedPages.push(pageNumber);
            }

            onProgress(
                10 * pageNumber / pdfDocument.numPages,
                `Verificando página ${pageNumber} de ${pdfDocument.numPages}...`
            );

            await waitForPaint();
        }

        if (!scannedPages.length) {
            onProgress(100, "O PDF já possui texto selecionável.");
            return bytes;
        }

        onProgress(12, "Preparando os idiomas de OCR...");

        const worker = await getOcrWorker();

        const output = await PDFLib.PDFDocument.load(bytes);

        const font = await output.embedFont(
            PDFLib.StandardFonts.Helvetica
        );

        let completed = 0;

        for (const pageNumber of scannedPages) {
            const sourcePage = await pdfDocument.getPage(pageNumber);

            const viewport = sourcePage.getViewport({
                scale: 2
            });

            const canvas = document.createElement("canvas");

            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);

            const context = canvas.getContext("2d", {
                willReadFrequently: true
            });

            if (!context) {
                throw new Error(
                    `Não foi possível processar a página ${pageNumber}.`
                );
            }

            try {
                await sourcePage.render({
                    canvasContext: context,
                    viewport
                }).promise;

                let recognition;

                try {
                    activeProgress = (percentage, description) => {
                        const fraction = (
                            completed + percentage / 100
                        ) / scannedPages.length;

                        onProgress(
                            12 + fraction * 85,
                            `${fileName}: ${description}`
                        );
                    };

                    recognition = await worker.recognize(canvas);
                } finally {
                    activeProgress = null;
                }

                const outputPage = output.getPage(pageNumber - 1);

                const words = recognition?.data?.words || [];

                // A camada invisível é posicionada palavra por palavra
                // para aproximar melhor as caixas de seleção do texto.
                for (const word of words) {
                    if (!word.text?.trim()) continue;

                    drawInvisibleWord(
                        outputPage,
                        font,
                        word,
                        {
                            box: word.bbox,
                            viewport
                        }
                    );
                }

                // Fallback caso o mecanismo não retorne palavras.
                if (!words.length) {
                    for (const line of recognition?.data?.lines || []) {
                        if (!line.text?.trim() || !line.bbox) continue;

                        drawInvisibleWord(
                            outputPage,
                            font,
                            {
                                text: line.text,
                                confidence: line.confidence
                            },
                            {
                                box: line.bbox,
                                viewport
                            }
                        );
                    }
                }
            } finally {
                canvas.width = 0;
                canvas.height = 0;
            }

            completed++;

            onProgress(
                12 + completed / scannedPages.length * 85,
                `OCR: página ${pageNumber} de ${pdfDocument.numPages} em ${fileName}.`
            );

            await waitForPaint();
        }

        onProgress(98, "Salvando o PDF pesquisável...");

        const result = await output.save({
            useObjectStreams: true,
            addDefaultPage: false
        });

        onProgress(100, "OCR concluído.");

        return result;
    } catch (error) {
        throw new Error(
            `Falha no OCR de "${fileName}": ${error?.message || error}`
        );
    } finally {
        if (pdfDocument) {
            await pdfDocument.destroy();
        } else if (loadingTask) {
            try {
                await loadingTask.destroy();
            } catch {
                // A tarefa pode já ter sido encerrada.
            }
        }
    }
}
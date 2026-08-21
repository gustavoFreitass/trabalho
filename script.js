"use strict";

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const selectButton = document.getElementById("selectButton");

const workspace = document.getElementById("workspace");
const fileList = document.getElementById("fileList");
const fileSummary = document.getElementById("fileSummary");

const outputName = document.getElementById("outputName");
const clearButton = document.getElementById("clearButton");
const mergeButton = document.getElementById("mergeButton");
const mergeButtonText = document.getElementById("mergeButtonText");

const progressArea = document.getElementById("progressArea");
const progressText = document.getElementById("progressText");
const progressPercentage = document.getElementById("progressPercentage");
const progressBar = document.getElementById("progressBar");

const message = document.getElementById("message");

let selectedFiles = [];
let processing = false;

/**
 * Abre a janela de seleção de arquivos.
 */
function openFileSelector() {
    if (!processing) {
        fileInput.click();
    }
}

dropZone.addEventListener("click", (event) => {
    if (event.target !== selectButton) {
        openFileSelector();
    }
});

selectButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openFileSelector();
});

dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openFileSelector();
    }
});

fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);

    // Permite selecionar novamente um arquivo com o mesmo nome.
    fileInput.value = "";
});

/**
 * Impede que o navegador abra o PDF ao arrastá-lo para a página.
 */
["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
});

["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
        if (!processing) {
            dropZone.classList.add("dragging");
        }
    });
});

["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
        dropZone.classList.remove("dragging");
    });
});

dropZone.addEventListener("drop", (event) => {
    if (processing) {
        return;
    }

    addFiles(event.dataTransfer.files);
});

clearButton.addEventListener("click", () => {
    if (processing) {
        return;
    }

    selectedFiles = [];
    hideMessage();
    renderFileList();
});

mergeButton.addEventListener("click", mergePdfs);

/**
 * Adiciona somente arquivos PDF válidos.
 */
function addFiles(fileCollection) {
    hideMessage();

    const files = Array.from(fileCollection);

    const invalidFiles = files.filter((file) => {
        const extensionIsPdf = file.name.toLowerCase().endsWith(".pdf");
        const mimeIsPdf = file.type === "application/pdf";

        return !extensionIsPdf && !mimeIsPdf;
    });

    const validFiles = files.filter((file) => {
        const extensionIsPdf = file.name.toLowerCase().endsWith(".pdf");
        const mimeIsPdf = file.type === "application/pdf";

        return extensionIsPdf || mimeIsPdf;
    });

    validFiles.forEach((file) => {
        const alreadyAdded = selectedFiles.some((item) => {
            return (
                item.file.name === file.name &&
                item.file.size === file.size &&
                item.file.lastModified === file.lastModified
            );
        });

        if (!alreadyAdded) {
            selectedFiles.push({
                id: crypto.randomUUID(),
                file,
                pageCount: null
            });
        }
    });

    if (invalidFiles.length > 0) {
        showMessage(
            `${invalidFiles.length} arquivo(s) ignorado(s), pois não são PDFs.`,
            "error"
        );
    }

    renderFileList();
    loadPageCounts();
}

/**
 * Tenta contar as páginas de cada documento.
 */
async function loadPageCounts() {
    if (!window.PDFLib) {
        return;
    }

    for (const item of selectedFiles) {
        if (item.pageCount !== null) {
            continue;
        }

        try {
            const bytes = await item.file.arrayBuffer();

            const pdf = await PDFLib.PDFDocument.load(bytes, {
                ignoreEncryption: false
            });

            item.pageCount = pdf.getPageCount();
        } catch {
            item.pageCount = "erro";
        }

        renderFileList();
    }
}

function renderFileList() {
    fileList.innerHTML = "";

    const hasFiles = selectedFiles.length > 0;

    workspace.classList.toggle("hidden", !hasFiles);

    if (!hasFiles) {
        fileSummary.textContent = "Nenhum arquivo selecionado";
        return;
    }

    const totalSize = selectedFiles.reduce((total, item) => {
        return total + item.file.size;
    }, 0);

    const totalPages = selectedFiles.reduce((total, item) => {
        return typeof item.pageCount === "number"
            ? total + item.pageCount
            : total;
    }, 0);

    const pageInformation =
        totalPages > 0
            ? ` • ${totalPages} página${totalPages === 1 ? "" : "s"}`
            : "";

    fileSummary.textContent =
        `${selectedFiles.length} arquivo` +
        `${selectedFiles.length === 1 ? "" : "s"}` +
        ` • ${formatFileSize(totalSize)}` +
        pageInformation;

    selectedFiles.forEach((item, index) => {
        const fileItem = document.createElement("article");
        fileItem.className = "file-item";

        const pageText =
            typeof item.pageCount === "number"
                ? `${item.pageCount} página${item.pageCount === 1 ? "" : "s"}`
                : item.pageCount === "erro"
                    ? "Não foi possível ler"
                    : "Analisando páginas...";

        fileItem.innerHTML = `
            <div class="file-position">${index + 1}</div>

            <div class="file-information">
                <div class="file-name" title="${escapeHtml(item.file.name)}">
                    ${escapeHtml(item.file.name)}
                </div>

                <div class="file-details">
                    ${formatFileSize(item.file.size)} • ${pageText}
                </div>
            </div>

            <div class="file-actions">
                <button
                    class="icon-button"
                    type="button"
                    data-action="up"
                    data-id="${item.id}"
                    aria-label="Mover arquivo para cima"
                    title="Mover para cima"
                    ${index === 0 || processing ? "disabled" : ""}
                >
                    ↑
                </button>

                <button
                    class="icon-button"
                    type="button"
                    data-action="down"
                    data-id="${item.id}"
                    aria-label="Mover arquivo para baixo"
                    title="Mover para baixo"
                    ${index === selectedFiles.length - 1 || processing ? "disabled" : ""}
                >
                    ↓
                </button>

                <button
                    class="icon-button remove"
                    type="button"
                    data-action="remove"
                    data-id="${item.id}"
                    aria-label="Remover arquivo"
                    title="Remover"
                    ${processing ? "disabled" : ""}
                >
                    ×
                </button>
            </div>
        `;

        fileList.appendChild(fileItem);
    });

    fileList.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", handleFileAction);
    });
}

function handleFileAction(event) {
    if (processing) {
        return;
    }

    const button = event.currentTarget;
    const action = button.dataset.action;
    const id = button.dataset.id;

    const currentIndex = selectedFiles.findIndex((item) => item.id === id);

    if (currentIndex < 0) {
        return;
    }

    if (action === "remove") {
        selectedFiles.splice(currentIndex, 1);
    }

    if (action === "up" && currentIndex > 0) {
        swapFiles(currentIndex, currentIndex - 1);
    }

    if (
        action === "down" &&
        currentIndex < selectedFiles.length - 1
    ) {
        swapFiles(currentIndex, currentIndex + 1);
    }

    hideMessage();
    renderFileList();
}

function swapFiles(firstIndex, secondIndex) {
    [
        selectedFiles[firstIndex],
        selectedFiles[secondIndex]
    ] = [
        selectedFiles[secondIndex],
        selectedFiles[firstIndex]
    ];
}

async function mergePdfs() {
    if (processing) {
        return;
    }

    if (selectedFiles.length === 0) {
        showMessage("Adicione pelo menos um arquivo PDF.", "error");
        return;
    }

    if (!window.PDFLib) {
        showMessage(
            "A biblioteca de PDF não foi carregada. Verifique a conexão ou use a versão local da biblioteca.",
            "error"
        );
        return;
    }

    const invalidDocument = selectedFiles.find(
        (item) => item.pageCount === "erro"
    );

    if (invalidDocument) {
        showMessage(
            `O arquivo "${invalidDocument.file.name}" não pôde ser lido. Ele pode estar corrompido ou protegido por senha.`,
            "error"
        );
        return;
    }

    processing = true;
    hideMessage();
    setInterfaceProcessing(true);
    updateProgress(0, "Preparando o documento...");

    try {
        const mergedPdf = await PDFLib.PDFDocument.create();

        for (let index = 0; index < selectedFiles.length; index++) {
            const item = selectedFiles[index];

            updateProgress(
                Math.round((index / selectedFiles.length) * 80),
                `Adicionando ${item.file.name}`
            );

            const sourceBytes = await item.file.arrayBuffer();

            const sourcePdf = await PDFLib.PDFDocument.load(sourceBytes, {
                ignoreEncryption: false
            });

            const sourcePageIndexes = sourcePdf.getPageIndices();

            const copiedPages = await mergedPdf.copyPages(
                sourcePdf,
                sourcePageIndexes
            );

            copiedPages.forEach((page) => {
                mergedPdf.addPage(page);
            });

            await waitForInterface();
        }

        updateProgress(88, "Gerando o arquivo final...");

        const mergedBytes = await mergedPdf.save({
            useObjectStreams: true,
            addDefaultPage: false
        });

        updateProgress(96, "Preparando o download...");

        const finalFileName = sanitizeFileName(outputName.value);

        downloadPdf(mergedBytes, `${finalFileName}.pdf`);

        updateProgress(100, "PDF criado com sucesso.");

        showMessage(
            `PDF criado com ${mergedPdf.getPageCount()} páginas.`,
            "success"
        );
    } catch (error) {
        console.error(error);

        const possiblePasswordError =
            String(error.message).toLowerCase().includes("encrypted");

        showMessage(
            possiblePasswordError
                ? "Um dos PDFs é protegido por senha e não pode ser processado."
                : "Não foi possível unir os PDFs. Verifique se os arquivos estão válidos.",
            "error"
        );
    } finally {
        processing = false;
        setInterfaceProcessing(false);
    }
}


function downloadPdf(bytes, fileName) {
    const blob = new Blob([bytes], {
        type: "application/pdf"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}

function setInterfaceProcessing(isProcessing) {
    mergeButton.disabled = isProcessing;
    clearButton.disabled = isProcessing;
    selectButton.disabled = isProcessing;

    mergeButtonText.textContent = isProcessing
        ? "Unindo arquivos..."
        : "Unir PDFs";

    progressArea.classList.toggle("hidden", !isProcessing);

    renderFileList();
}

function updateProgress(percentage, text) {
    const safePercentage = Math.max(0, Math.min(100, percentage));

    progressBar.style.width = `${safePercentage}%`;
    progressPercentage.textContent = `${safePercentage}%`;
    progressText.textContent = text;
}

function showMessage(text, type) {
    message.textContent = text;
    message.className = `message ${type}`;
}

function hideMessage() {
    message.textContent = "";
    message.className = "message hidden";
}

function formatFileSize(bytes) {
    if (bytes === 0) {
        return "0 B";
    }

    const units = ["B", "KB", "MB", "GB"];
    const unitIndex = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1
    );

    const value = bytes / Math.pow(1024, unitIndex);

    return `${value.toLocaleString("pt-BR", {
        maximumFractionDigits: unitIndex === 0 ? 0 : 2
    })} ${units[unitIndex]}`;
}

function sanitizeFileName(value) {
    const sanitized = value
        .trim()
        .replace(/\.pdf$/i, "")
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
        .replace(/\.+$/g, "");

    return sanitized || "PDF_Unificado";
}

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function waitForInterface() {
    return new Promise((resolve) => {
        window.setTimeout(resolve, 20);
    });
}
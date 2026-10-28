import {
    SUPPORTED_EXTENSIONS,
    OFFICE_EXTENSIONS,
    getExtension,
    formatFileSize,
    sanitizeFileName,
    isSupportedFile,
    showStatus,
    clearStatus,
    updateProgress,
    hideProgress,
    downloadPdf,
    getFriendlyError
} from "./utils.js";
import { convertFileToPdf } from "./converter.js";
import { mergeFiles } from "./merger.js";

const state = {
    merge: [],
    convert: null,
    ocr: [],
    busy: false,
    activeTab: null
};

const $ = id => document.getElementById(id);

function makeId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : `file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function duplicate(items, file) {
    return items.some(item =>
        item.file.name === file.name &&
        item.file.size === file.size &&
        item.file.lastModified === file.lastModified
    );
}

function switchTab(name) {
    if (state.busy) return;

    state.activeTab = name;

    const choices = document.getElementById("toolChoices");
    const hint = document.getElementById("selectionHint");

    choices?.classList.add("has-selection");

    document.querySelectorAll(".tool-choice").forEach(card => {
        const active = card.dataset.tab === name;

        card.classList.toggle("is-selected", active);
        card.classList.toggle("is-entering", active);
        card.setAttribute("aria-pressed", String(active));

        if (active) {
            window.setTimeout(() => {
                card.classList.remove("is-entering");
            }, 850);
        }
    });

    document.querySelectorAll("[data-panel]").forEach(panel => {
        const active = panel.dataset.panel === name;

        panel.classList.toggle("hidden", !active);
        panel.hidden = !active;
        panel.classList.remove("is-entering");

        if (active) {
            requestAnimationFrame(() => {
                panel.classList.add("is-entering");
            });

            window.setTimeout(() => {
                panel.classList.remove("is-entering");
            }, 850);
        }
    });

    if (hint) {
        hint.classList.add("is-selected");
        hint.innerHTML = '<span class="hint-key">↳</span> Ferramenta aberta. Você pode trocar de opção a qualquer momento.';
    }

    clearStatus(name);

    window.setTimeout(() => {
        document.getElementById(`panel-${name}`)?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }, 90);
}

function resetToolSelection() {
    if (state.busy) return;

    state.activeTab = null;

    document.getElementById("toolChoices")?.classList.remove("has-selection");

    document.querySelectorAll(".tool-choice").forEach(card => {
        card.classList.remove("is-selected", "is-entering");
        card.setAttribute("aria-pressed", "false");
    });

    document.querySelectorAll("[data-panel]").forEach(panel => {
        panel.classList.add("hidden");
        panel.classList.remove("is-entering");
        panel.hidden = true;
    });

    const hint = document.getElementById("selectionHint");

    if (hint) {
        hint.classList.remove("is-selected");
        hint.innerHTML = '<span class="hint-key">↳</span> Clique em uma opção para abrir as ferramentas.';
    }

    window.setTimeout(() => {
        document.getElementById("toolChoices")?.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }, 30);
}

document.querySelectorAll(".tool-choice").forEach((card, index, cards) => {
    card.addEventListener("click", () => {
        switchTab(card.dataset.tab);
    });

    card.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

        event.preventDefault();

        let next = index;

        if (event.key === "ArrowRight") {
            next = (index + 1) % cards.length;
        } else if (event.key === "ArrowLeft") {
            next = (index - 1 + cards.length) % cards.length;
        } else if (event.key === "Home") {
            next = 0;
        } else {
            next = cards.length - 1;
        }

        cards[next].focus();
    });
});

document.querySelectorAll("[data-return-tools]").forEach(button => {
    button.addEventListener("click", resetToolSelection);
});

function setupDropZone(zoneId, inputId, onFiles, multiple = true) {
    const zone = $(zoneId);
    const input = $(inputId);

    zone.addEventListener("click", event => {
        if (!state.busy && !event.target.closest("button")) {
            input.click();
        }
    });

    zone.addEventListener("keydown", event => {
        if (state.busy || !["Enter", " "].includes(event.key)) return;

        event.preventDefault();
        input.click();
    });

    zone.addEventListener("dragover", event => {
        event.preventDefault();

        if (!state.busy) {
            zone.classList.add("dragging");
        }
    });

    zone.addEventListener("dragleave", () => {
        zone.classList.remove("dragging");
    });

    zone.addEventListener("drop", event => {
        event.preventDefault();
        zone.classList.remove("dragging");

        if (state.busy) return;

        let files = Array.from(event.dataTransfer.files);

        if (!multiple && files.length > 1) {
            showStatus(
                state.activeTab,
                "Esta ferramenta aceita um arquivo por vez.",
                "warning"
            );
            files = files.slice(0, 1);
        }

        onFiles(files);
    });

    input.addEventListener("change", () => {
        let files = Array.from(input.files);

        if (!multiple) {
            files = files.slice(0, 1);
        }

        onFiles(files);
        input.value = "";
    });
}

document.addEventListener("dragover", event => event.preventDefault());
document.addEventListener("drop", event => event.preventDefault());

setupDropZone("mergeDropZone", "mergeInput", addMergeFiles);
setupDropZone("convertDropZone", "convertInput", handleConvertFiles, false);
setupDropZone("ocrDropZone", "ocrInput", addOcrFiles);

$("mergeSelectButton").addEventListener("click", event => {
    event.stopPropagation();

    if (!state.busy) {
        $("mergeInput").click();
    }
});

$("convertSelectButton").addEventListener("click", event => {
    event.stopPropagation();

    if (!state.busy) {
        $("convertInput").click();
    }
});

$("ocrSelectButton").addEventListener("click", event => {
    event.stopPropagation();

    if (!state.busy) {
        $("ocrInput").click();
    }
});

function addMergeFiles(files) {
    if (state.busy) return;

    let added = 0;
    const unsupported = [];
    const large = [];

    for (const file of files) {
        if (!isSupportedFile(file)) {
            unsupported.push(file.name);
            continue;
        }

        if (duplicate(state.merge, file)) continue;

        state.merge.push({
            id: makeId(),
            file
        });

        added++;

        if (
            OFFICE_EXTENSIONS.has(getExtension(file.name)) &&
            file.size > 3.8 * 1024 * 1024
        ) {
            large.push(file.name);
        }
    }

    renderMergeFiles();
    clearStatus("merge");

    if (unsupported.length) {
        showStatus(
            "merge",
            `Formatos não compatíveis: ${unsupported.join(", ")}`,
            "warning"
        );
    } else if (large.length) {
        showStatus(
            "merge",
            `Documentos Office acima do limite de conversão: ${large.join(", ")}.`,
            "warning"
        );
    } else if (!added && files.length) {
        showStatus(
            "merge",
            "Os arquivos selecionados já estão na lista.",
            "warning"
        );
    }
}

function renderMergeFiles() {
    renderFileList("mergeFileList", state.merge, true, handleMergeAction);

    const has = state.merge.length > 0;

    $("mergeWorkspace").classList.toggle("hidden", !has);

    $("mergeSummary").textContent = has
        ? `${state.merge.length} arquivo(s) · ${formatFileSize(state.merge.reduce((sum, item) => sum + item.file.size, 0))}`
        : "Nenhum arquivo selecionado";

    refreshButtons();
}

function handleMergeAction(action, id) {
    if (state.busy) return;

    const index = state.merge.findIndex(item => item.id === id);

    if (index < 0) return;

    if (action === "remove") {
        state.merge.splice(index, 1);
    }

    if (action === "up" && index > 0) {
        [state.merge[index - 1], state.merge[index]] =
            [state.merge[index], state.merge[index - 1]];
    }

    if (action === "down" && index < state.merge.length - 1) {
        [state.merge[index], state.merge[index + 1]] =
            [state.merge[index + 1], state.merge[index]];
    }

    clearStatus("merge");
    renderMergeFiles();
}

$("mergeClearButton").addEventListener("click", () => {
    if (state.busy) return;

    state.merge = [];

    clearStatus("merge");
    renderMergeFiles();
});

function handleConvertFiles(files) {
    if (state.busy || !files.length) return;

    const file = files[0];

    if (!isSupportedFile(file)) {
        showStatus(
            "convert",
            `O formato "${getExtension(file.name)}" não é compatível.`,
            "warning"
        );
        return;
    }

    state.convert = file;

    $("convertSelection").classList.remove("hidden");
    $("convertFileName").textContent = file.name;
    $("convertFileName").title = file.name;
    $("convertFileDetails").textContent =
        `${getExtension(file.name).toUpperCase()} · ${formatFileSize(file.size)}`;

    $("convertOutputName").value =
        sanitizeFileName(file.name.replace(/\.[^.]+$/, ""));

    clearStatus("convert");
    refreshButtons();
}

$("convertRemoveButton").addEventListener("click", () => {
    if (state.busy) return;

    state.convert = null;
    $("convertSelection").classList.add("hidden");
    $("convertOutputName").value = "Documento_Convertido";

    clearStatus("convert");
    refreshButtons();
});

function addOcrFiles(files) {
    if (state.busy) return;

    const added = [];
    const unsupported = [];
    const imageExtensions = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif"]);

    for (const file of files) {
        const ext = getExtension(file.name);

        if (ext !== "pdf" && !imageExtensions.has(ext)) {
            unsupported.push(file.name);
            continue;
        }

        if (!duplicate(state.ocr, file)) {
            added.push({
                id: makeId(),
                file
            });
        }
    }

    state.ocr.push(...added);

    renderOcrFiles();
    clearStatus("ocr");

    if (unsupported.length) {
        showStatus(
            "ocr",
            `O OCR aceita PDFs e imagens. Ignorados: ${unsupported.join(", ")}`,
            "warning"
        );
    } else if (!added.length && files.length) {
        showStatus("ocr", "Os arquivos já estão na lista.", "warning");
    }
}

function renderOcrFiles() {
    renderFileList("ocrFileList", state.ocr, false, handleOcrAction);

    const has = state.ocr.length > 0;

    $("ocrWorkspace").classList.toggle("hidden", !has);

    $("ocrSummary").textContent = has
        ? `${state.ocr.length} arquivo(s) · ${formatFileSize(state.ocr.reduce((sum, item) => sum + item.file.size, 0))}`
        : "Nenhum arquivo selecionado";

    refreshButtons();
}

function handleOcrAction(action, id) {
    if (state.busy || action !== "remove") return;

    state.ocr = state.ocr.filter(item => item.id !== id);

    clearStatus("ocr");
    renderOcrFiles();
}

$("ocrClearButton").addEventListener("click", () => {
    if (state.busy) return;

    state.ocr = [];

    clearStatus("ocr");
    renderOcrFiles();
});

function renderFileList(id, items, canMove, callback) {
    const container = $(id);

    container.replaceChildren();

    items.forEach((item, index) => {
        const row = document.createElement("article");
        row.className = "file-row";

        const number = document.createElement("span");
        number.className = "file-index";
        number.textContent = String(index + 1).padStart(2, "0");

        const info = document.createElement("div");
        info.className = "file-info";

        const name = document.createElement("div");
        name.className = "file-name";
        name.textContent = item.file.name;
        name.title = item.file.name;

        const meta = document.createElement("div");
        meta.className = "file-meta";
        meta.textContent =
            `${formatFileSize(item.file.size)} · ${getExtension(item.file.name).toUpperCase()}`;

        info.append(name, meta);

        const type = document.createElement("span");
        type.className = "file-type";
        type.textContent = getExtension(item.file.name).toUpperCase() || "ARQ";

        const actions = document.createElement("div");
        actions.className = "file-actions";

        if (canMove) {
            actionButton(
                actions,
                "↑",
                "Mover para cima",
                "up",
                item.id,
                index === 0,
                callback
            );

            actionButton(
                actions,
                "↓",
                "Mover para baixo",
                "down",
                item.id,
                index === items.length - 1,
                callback
            );
        }

        actionButton(
            actions,
            "×",
            "Remover arquivo",
            "remove",
            item.id,
            false,
            callback,
            true
        );

        row.append(number, info, type, actions);
        container.appendChild(row);
    });
}

function actionButton(parent, label, title, action, id, disabled, callback, danger = false) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = danger ? "icon-button remove" : "icon-button";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.disabled = disabled || state.busy;

    button.addEventListener("click", () => {
        callback(action, id);
    });

    parent.appendChild(button);
}

$("mergeButton").addEventListener("click", () => {
    runTask("merge", async progress => {
        const bytes = await mergeFiles(
            state.merge.map(item => item.file),
            {
                applyOcr: $("mergeOcr").checked,
                onProgress: progress
            }
        );

        downloadPdf(bytes, $("mergeOutputName").value);
        showStatus("merge", "PDF combinado gerado com sucesso.", "success");
    });
});

$("convertButton").addEventListener("click", () => {
    runTask("convert", async progress => {
        const bytes = await convertFileToPdf(state.convert, progress);

        downloadPdf(bytes, $("convertOutputName").value);
        showStatus("convert", "PDF gerado com sucesso.", "success");
    });
});

$("ocrButton").addEventListener("click", () => {
    runTask("ocr", async progress => {
        const bytes = await mergeFiles(
            state.ocr.map(item => item.file),
            {
                applyOcr: true,
                onProgress: progress
            }
        );

        downloadPdf(bytes, $("ocrOutputName").value);
        showStatus("ocr", "PDF pesquisável gerado com sucesso.", "success");
    });
});

async function runTask(prefix, operation) {
    if (state.busy) return;

    state.busy = true;

    clearStatus(prefix);
    updateProgress(prefix, 0, "Iniciando...");
    refreshButtons();

    try {
        await operation((percentage, text) => {
            updateProgress(prefix, percentage, text);
        });
    } catch (error) {
        console.error(error);
        showStatus(prefix, getFriendlyError(error), "error");
    } finally {
        state.busy = false;
        hideProgress(prefix);
        refreshButtons();
    }
}

function refreshButtons() {
    $("mergeButton").disabled = state.busy || !state.merge.length;
    $("convertButton").disabled = state.busy || !state.convert;
    $("ocrButton").disabled = state.busy || !state.ocr.length;

    [
        "mergeSelectButton",
        "convertSelectButton",
        "ocrSelectButton",
        "mergeClearButton",
        "ocrClearButton",
        "convertRemoveButton",
        "mergeInput",
        "convertInput",
        "ocrInput",
        "mergeOutputName",
        "convertOutputName",
        "ocrOutputName",
        "mergeOcr"
    ].forEach(id => {
        const element = $(id);

        if (element) {
            element.disabled = state.busy;
        }
    });

    document.querySelectorAll(".tool-choice, [data-return-tools]").forEach(button => {
        button.disabled = state.busy;
    });

    document.querySelectorAll(".file-actions button").forEach(button => {
        button.disabled = state.busy;
    });
}

renderMergeFiles();
renderOcrFiles();
refreshButtons();
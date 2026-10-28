import io
import os
import shutil
import subprocess
import tempfile

from pathlib import Path

from flask import (
    Flask,
    jsonify,
    request,
    send_file,
    send_from_directory,
)
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
JS_DIR = BASE_DIR / "js"

MAX_FILE_BYTES = int(3.8 * 1024 * 1024)
MAX_PDF_BYTES = 4 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024
CONVERSION_TIMEOUT_SECONDS = 100

SUPPORTED_EXTENSIONS = {
    ".doc",
    ".docx",
    ".odt",
    ".rtf",
    ".xls",
    ".xlsx",
    ".ods",
    ".ppt",
    ".pptx",
    ".odp",
    ".csv",
    ".html",
    ".htm",
}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES


# --------------------------------------------------
# CABEÇALHOS DE SEGURANÇA
# --------------------------------------------------

@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"

    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"

    return response


# --------------------------------------------------
# ERROS DE REQUISIÇÃO
# --------------------------------------------------

@app.errorhandler(RequestEntityTooLarge)
def handle_request_too_large(_error):
    return jsonify({
        "error": (
            "O arquivo enviado ultrapassou o limite de "
            "tamanho configurado para esta aplicação."
        )
    }), 413


# --------------------------------------------------
# ARQUIVOS DA INTERFACE
# --------------------------------------------------

@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/style.css")
def stylesheet():
    return send_from_directory(BASE_DIR, "style.css")


@app.get("/js/<path:filename>")
def javascript_module(filename):
    return send_from_directory(JS_DIR, filename)


# --------------------------------------------------
# LOCALIZAÇÃO DO LIBREOFFICE
# --------------------------------------------------

def find_libreoffice():
    """
    Procura o executável do LibreOffice:
    1. Caminho configurado em LIBREOFFICE_PATH.
    2. Executáveis disponíveis no PATH.
    3. Diretórios comuns do Windows.
    4. Diretórios comuns de Linux.
    """

    configured_path = os.environ.get("LIBREOFFICE_PATH")

    if configured_path:
        configured = Path(configured_path).expanduser()

        # A variável pode apontar diretamente para o executável.
        if configured.is_file():
            return str(configured.resolve())

        # Ou pode apontar para a pasta de instalação.
        if configured.is_dir():
            executable_names = (
                "soffice.com",
                "soffice.exe",
                "soffice",
                "libreoffice",
            )

            for name in executable_names:
                candidate = configured / name

                if candidate.is_file():
                    return str(candidate.resolve())

    # Procura executáveis no PATH.
    executable_names = (
        "soffice.com",
        "soffice.exe",
        "soffice",
        "libreoffice",
    )

    for name in executable_names:
        found = shutil.which(name)

        if found:
            return found

    # Caminhos comuns do Windows.
    if os.name == "nt":
        windows_candidates = [
            Path(
                r"C:\Program Files\LibreOffice\program\soffice.com"
            ),
            Path(
                r"C:\Program Files\LibreOffice\program\soffice.exe"
            ),
            Path(
                r"C:\Program Files (x86)\LibreOffice\program\soffice.com"
            ),
            Path(
                r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"
            ),
        ]

        for candidate in windows_candidates:
            if candidate.is_file():
                return str(candidate)

    # Caminhos comuns do Linux.
    unix_candidates = [
        Path("/usr/bin/soffice"),
        Path("/usr/bin/libreoffice"),
        Path("/usr/local/bin/soffice"),
        Path("/snap/bin/libreoffice"),
        Path("/opt/libreoffice/program/soffice"),
    ]

    for candidate in unix_candidates:
        if candidate.is_file():
            return str(candidate)

    return None


def valid_pdf(data):
    return len(data) >= 5 and data[:5] == b"%PDF-"


# --------------------------------------------------
# DIAGNÓSTICO
# --------------------------------------------------

@app.get("/api/health")
def health():
    executable = find_libreoffice()

    return jsonify({
        "status": "ok",
        "service": "PDF Workstation",
        "libreoffice_available": bool(executable),
        "libreoffice_path": executable,
    })


# --------------------------------------------------
# CONVERSÃO OFFICE PARA PDF
# --------------------------------------------------

@app.post("/api/convert-to-pdf")
def convert_to_pdf():
    uploaded = request.files.get("file")

    if not uploaded or not uploaded.filename:
        return jsonify({
            "error": "Nenhum arquivo foi enviado."
        }), 400

    original_name = Path(uploaded.filename).name
    extension = Path(original_name).suffix.lower()

    if extension not in SUPPORTED_EXTENSIONS:
        return jsonify({
            "error": (
                f"O formato {extension or '(sem extensão)'} "
                "não é compatível com o conversor Office."
            )
        }), 415

    executable = find_libreoffice()

    if not executable:
        app.logger.error(
            "LibreOffice não encontrado. "
            "PATH=%s",
            os.environ.get("PATH", ""),
        )

        return jsonify({
            "error": (
                "O mecanismo LibreOffice não está disponível. "
                "Verifique se ele está instalado no ambiente "
                "em que o servidor Python está sendo executado."
            )
        }), 503

    # Lê no máximo o limite permitido mais um byte.
    uploaded_bytes = uploaded.read(MAX_FILE_BYTES + 1)

    if len(uploaded_bytes) > MAX_FILE_BYTES:
        return jsonify({
            "error": (
                "O arquivo Office ultrapassa o limite de "
                "aproximadamente 3,8 MiB desta versão."
            )
        }), 413

    if not uploaded_bytes:
        return jsonify({
            "error": "O arquivo recebido está vazio."
        }), 400

    try:
        with tempfile.TemporaryDirectory(
            prefix="pdf-workstation-"
        ) as temporary_directory:

            root = Path(temporary_directory)

            input_dir = root / "input"
            output_dir = root / "output"
            profile_dir = root / "profile"
            home_dir = root / "home"

            for directory in (
                input_dir,
                output_dir,
                profile_dir,
                home_dir,
            ):
                directory.mkdir()

            # O nome no disco é fixo para não permitir
            # que nomes enviados pelo usuário alterem os caminhos.
            input_path = input_dir / f"document{extension}"
            output_path = output_dir / "document.pdf"

            input_path.write_bytes(uploaded_bytes)

            command = [
                executable,
                "--headless",
                "--nologo",
                "--nodefault",
                "--norestore",
                "--nolockcheck",
                (
                    "-env:UserInstallation="
                    f"{profile_dir.resolve().as_uri()}"
                ),
                "--convert-to",
                "pdf",
                "--outdir",
                str(output_dir),
                str(input_path),
            ]

            environment = os.environ.copy()
            environment["HOME"] = str(home_dir)
            environment["TMPDIR"] = str(root)

            try:
                result = subprocess.run(
                    command,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=CONVERSION_TIMEOUT_SECONDS,
                    check=False,
                    env=environment,
                )

            except subprocess.TimeoutExpired:
                return jsonify({
                    "error": (
                        "A conversão excedeu o tempo limite. "
                        "Tente um documento menor."
                    )
                }), 504

            except OSError:
                app.logger.exception(
                    "Não foi possível iniciar o LibreOffice."
                )

                return jsonify({
                    "error": (
                        "O executável foi encontrado, mas "
                        "não pôde ser iniciado."
                    )
                }), 503

            if result.returncode != 0 or not output_path.is_file():
                app.logger.warning(
                    "Falha na conversão. Código=%s; stderr=%s",
                    result.returncode,
                    result.stderr.decode(
                        "utf-8",
                        errors="replace",
                    )[-1000:],
                )

                return jsonify({
                    "error": (
                        "O LibreOffice não conseguiu converter "
                        "o documento. Verifique se o arquivo "
                        "está válido ou protegido por senha."
                    )
                }), 422

            pdf_bytes = output_path.read_bytes()

            if not valid_pdf(pdf_bytes):
                app.logger.warning(
                    "O LibreOffice não retornou um PDF válido."
                )

                return jsonify({
                    "error": "O conversor não gerou um PDF válido."
                }), 500

            if len(pdf_bytes) > MAX_PDF_BYTES:
                return jsonify({
                    "error": (
                        "O PDF gerado ultrapassou o limite de "
                        "saída desta versão."
                    )
                }), 413

            safe_name = (
                secure_filename(Path(original_name).stem)
                or "documento"
            )

            response = send_file(
                io.BytesIO(pdf_bytes),
                mimetype="application/pdf",
                as_attachment=True,
                download_name=f"{safe_name}.pdf",
                max_age=0,
            )

            response.headers["Cache-Control"] = "no-store"

            return response

    except Exception:
        app.logger.exception(
            "Erro interno durante a conversão Office."
        )

        return jsonify({
            "error": (
                "Ocorreu um erro interno durante a conversão."
            )
        }), 500


# --------------------------------------------------
# INICIALIZAÇÃO LOCAL
# --------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))

    app.run(
        host="127.0.0.1",
        port=port,
        debug=False,
    )
    
    
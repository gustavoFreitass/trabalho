# PDF Workstation

Projeto com frontend HTML/CSS/JavaScript, módulos ES, API Flask e LibreOffice em modo headless para converter documentos Office em PDF.

## Arquitetura

- `index.html`, `style.css`: interface web.
- `js/converter.js`: conversão de documentos Office via API e conversão local de textos/imagens.
- `js/merger.js`: união de PDFs e documentos convertidos.
- `js/ocr.js`: OCR local no navegador com PDF.js e Tesseract.js.
- `js/main.js`: navegação, seleção de arquivos e controles da interface.
- `app.py`: API HTTP, servindo interface e convertendo formatos Office pelo LibreOffice.
- `Dockerfile.vercel`: imagem que instala LibreOffice e inicia Gunicorn.

## Teste local

1. Instale Python 3.12 ou compatível e LibreOffice.
2. Instale as dependências:

   ```bash
   python -m pip install -r requirements.txt
   ```

3. Execute `python app.py`.
4. Acesse `http://127.0.0.1:5000`.
5. Confira `http://127.0.0.1:5000/api/health` para confirmar que a API está ativa.

O modo de execução local usa o LibreOffice instalado no sistema. O `Dockerfile.vercel` instala o programa no contêiner.

## Implantação na Vercel

A Vercel documenta o uso de `Dockerfile.vercel` para aplicações HTTP em contêineres. Faça commit de todos os arquivos e confirme se a plataforma aceita/constrói o contêiner no projeto e plano utilizados. O servidor lê `PORT` e escuta em `0.0.0.0` quando iniciado pelo Gunicorn.

Antes de publicar, verifique a documentação da Vercel sobre contêineres, tamanho da requisição/resposta e limites de execução do plano. Esta implementação deliberadamente limita upload Office a 3,8 MiB e PDF convertido a 4 MiB para manter-se abaixo dos limites comuns de payload. Os limites exatos e o suporte a contêineres dependem da plataforma/plano vigente.

## Segurança e privacidade

- A interface é pública enquanto não houver autenticação na camada da aplicação ou proteção de acesso na plataforma.
- O frontend envia documentos Office à rota `/api/convert-to-pdf`; portanto, esses documentos são processados no contêiner, não exclusivamente no navegador.
- O servidor usa diretórios temporários e os remove ao fim da requisição.
- Antes de usar com documentos confidenciais, configure autenticação apropriada para as oito pessoas, além de políticas de acesso e logs.
- Não armazene documentos ou PDFs gerados em diretórios permanentes do contêiner.

## Formatos

Office: DOC, DOCX, ODT, RTF, XLS, XLSX, ODS, PPT, PPTX, ODP, CSV e HTML são enviados ao LibreOffice.

Imagens: PNG, JPG/JPEG, WEBP, BMP e GIF são convertidas localmente no navegador.

Texto: TXT, MD, JSON e XML são colocados em páginas PDF pelo navegador. PDF é carregado diretamente. O OCR é executado no navegador; o Tesseract baixa seus modelos de idioma da internet na primeira execução.

## Limitações

- Os formatos Office dependem do LibreOffice e de fontes instaladas; a impressão pode diferir entre LibreOffice e Microsoft Office.
- Limites de payload de funções/contêineres da Vercel podem mudar. O armazenamento remoto é necessário para arquivos maiores que o limite definido.
- Não existe autenticação própria incluída neste pacote.
- O OCR depende da qualidade da digitalização e do carregamento dos modelos.

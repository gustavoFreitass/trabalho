import { MAX_OFFICE_FILE_BYTES, MAX_CONVERTED_PDF_BYTES, OFFICE_EXTENSIONS, IMAGE_EXTENSIONS, TEXT_EXTENSIONS, getExtension, formatFileSize, waitForGlobal } from "./utils.js";

export async function convertFileToPdf(file,onProgress=()=>{}) {
    const ext=getExtension(file.name);onProgress(5,`Preparando ${file.name}...`);
    if(ext==="pdf"){const bytes=await file.arrayBuffer();onProgress(100,"PDF pronto.");return bytes;}
    if(OFFICE_EXTENSIONS.has(ext))return convertWithLibreOffice(file,onProgress);
    if(IMAGE_EXTENSIONS.has(ext))return convertImageToPdf(file,onProgress);
    if(TEXT_EXTENSIONS.has(ext))return convertTextToPdf(file,onProgress);
    throw new Error(`O formato .${ext||"sem extensão"} não é compatível.`);
}

async function convertWithLibreOffice(file,onProgress) {
    if(file.size>MAX_OFFICE_FILE_BYTES)throw new Error(`O arquivo "${file.name}" tem ${formatFileSize(file.size)}. O limite de envio para o LibreOffice nesta versão é de aproximadamente 3,8 MiB.`);
    onProgress(15,`Enviando ${file.name} para conversão...`);
    const form=new FormData();form.append("file",file,file.name);let response;
    try{response=await fetch("/api/convert-to-pdf",{method:"POST",body:form,credentials:"same-origin"});}catch{throw new Error("Não foi possível acessar a API de conversão. Verifique se o serviço está funcionando.");}
    if(!response.ok){let body={};try{body=await response.json();}catch{}throw new Error(body.error||`Falha ao converter o arquivo (HTTP ${response.status}).`);}
    onProgress(85,"Recebendo o PDF convertido...");const bytes=await response.arrayBuffer();
    if(bytes.byteLength>MAX_CONVERTED_PDF_BYTES)throw new Error("O PDF gerado ultrapassou o limite de saída desta versão.");
    if(bytes.byteLength<5||new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")throw new Error("O servidor não retornou um PDF válido.");
    onProgress(100,"Conversão concluída.");return bytes;
}

export async function convertImageToPdf(file,onProgress=()=>{}) {
    const {jsPDF}=await waitForGlobal("jspdf");onProgress(10,`Carregando imagem ${file.name}...`);const url=URL.createObjectURL(file);
    try{const image=new Image();image.src=url;await image.decode();const max=3500;const scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const ctx=canvas.getContext("2d",{alpha:false});if(!ctx)throw new Error("Não foi possível preparar a imagem para PDF.");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);const data=canvas.toDataURL("image/jpeg",.94);onProgress(60,"Montando a página PDF...");const landscape=canvas.width>canvas.height;const pdf=new jsPDF({orientation:landscape?"landscape":"portrait",unit:"pt",format:"a4",compress:true});const pw=pdf.internal.pageSize.getWidth(),ph=pdf.internal.pageSize.getHeight(),margin=24;const ratio=Math.min((pw-2*margin)/canvas.width,(ph-2*margin)/canvas.height);const w=canvas.width*ratio,h=canvas.height*ratio;pdf.addImage(data,"JPEG",(pw-w)/2,(ph-h)/2,w,h,undefined,"FAST");canvas.width=0;canvas.height=0;onProgress(100,"Imagem convertida.");return pdf.output("arraybuffer");}finally{URL.revokeObjectURL(url);}
}

export async function convertTextToPdf(file,onProgress=()=>{}) {
    const {jsPDF}=await waitForGlobal("jspdf");onProgress(10,`Lendo ${file.name}...`);const content=await file.text();const pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true});const margin=14,lineHeight=4.5,ph=pdf.internal.pageSize.getHeight(),pw=pdf.internal.pageSize.getWidth();pdf.setFont("courier","normal");pdf.setFontSize(9);let y=margin;const lines=content.replace(/\r\n?/g,"\n").split("\n");
    for(let i=0;i<lines.length;i++){const wrapped=lines[i]?pdf.splitTextToSize(lines[i],pw-2*margin):[""];for(const line of wrapped){if(y+lineHeight>ph-margin){pdf.addPage();y=margin;}if(line)pdf.text(line,margin,y);y+=lineHeight;}if(i%100===0){onProgress(10+(i/Math.max(lines.length,1))*80,"Convertendo texto...");await new Promise(resolve=>setTimeout(resolve,0));}}
    onProgress(100,"Texto convertido.");return pdf.output("arraybuffer");
}

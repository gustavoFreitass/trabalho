import { convertFileToPdf } from "./converter.js";
import { makePdfSearchable } from "./ocr.js";
import { waitForGlobal, waitForPaint } from "./utils.js";

export async function mergeFiles(files,{applyOcr=false,onProgress=()=>{}}={}) {
    if(!files.length)throw new Error("Adicione pelo menos um arquivo.");
    const {PDFDocument}=await waitForGlobal("PDFLib");const output=await PDFDocument.create();
    for(let i=0;i<files.length;i++){
        const file=files[i];const start=(i/files.length)*85;const segment=85/files.length;
        onProgress(start,`Convertendo ${file.name} (${i+1}/${files.length})...`);
        let bytes=await convertFileToPdf(file,(p,text)=>onProgress(start+segment*(p/100)*.7,text));
        if(applyOcr)bytes=await makePdfSearchable(bytes,file.name,(p,text)=>onProgress(start+segment*(.7+(p/100)*.25),text));
        onProgress(start+segment*.96,`Adicionando páginas de ${file.name}...`);
        let source;try{source=await PDFDocument.load(bytes);}catch{throw new Error(`Não foi possível ler o PDF de "${file.name}". O arquivo pode estar protegido por senha ou corrompido.`);}
        const pages=await output.copyPages(source,source.getPageIndices());pages.forEach(page=>output.addPage(page));await waitForPaint();
    }
    if(!output.getPageCount())throw new Error("Nenhuma página foi adicionada ao PDF final.");onProgress(94,"Finalizando documento combinado...");const bytes=await output.save({useObjectStreams:true,addDefaultPage:false});onProgress(100,`PDF pronto: ${output.getPageCount()} página(s).`);return bytes;
}

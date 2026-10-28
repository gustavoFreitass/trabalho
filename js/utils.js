export const MAX_OFFICE_FILE_BYTES = Math.floor(3.8 * 1024 * 1024);
export const MAX_CONVERTED_PDF_BYTES = 4 * 1024 * 1024;
export const SUPPORTED_EXTENSIONS = new Set(["pdf","doc","docx","odt","rtf","xls","xlsx","ods","ppt","pptx","odp","csv","txt","md","json","xml","html","htm","png","jpg","jpeg","webp","bmp","gif"]);
export const OFFICE_EXTENSIONS = new Set(["doc","docx","odt","rtf","xls","xlsx","ods","ppt","pptx","odp","csv","html","htm"]);
export const IMAGE_EXTENSIONS = new Set(["png","jpg","jpeg","webp","bmp","gif"]);
export const TEXT_EXTENSIONS = new Set(["txt","md","json","xml"]);

export function getExtension(name){const i=name.lastIndexOf(".");return i<0?"":name.slice(i+1).toLowerCase();}
export function formatFileSize(bytes){if(bytes===0)return "0 B";const units=["B","KB","MB","GB"];const i=Math.min(Math.floor(Math.log(bytes)/Math.log(1024)),units.length-1);return `${(bytes/1024**i).toLocaleString("pt-BR",{maximumFractionDigits:i===0?0:2})} ${units[i]}`;}
export function sanitizeFileName(value){return String(value||"").trim().replace(/\.pdf$/i,"").replace(/[<>:"/\\|?*\u0000-\u001F]/g,"_").replace(/[. ]+$/g,"")||"Documento";}
export function isSupportedFile(file){return SUPPORTED_EXTENSIONS.has(getExtension(file.name));}
export function showStatus(prefix,text,type="info"){const el=document.getElementById(`${prefix}Status`);if(!el)return;el.textContent=text;el.className=`status-message ${type}`;}
export function clearStatus(prefix){const el=document.getElementById(`${prefix}Status`);if(!el)return;el.textContent="";el.className="status-message hidden";}
export function updateProgress(prefix,percentage,text){const area=document.getElementById(`${prefix}Progress`);const label=document.getElementById(`${prefix}ProgressText`);const value=document.getElementById(`${prefix}ProgressPercent`);const bar=document.getElementById(`${prefix}ProgressBar`);if(!area||!label||!value||!bar)return;const p=Math.max(0,Math.min(100,Math.round(percentage)));area.classList.remove("hidden");label.textContent=text;value.textContent=`${p}%`;bar.style.width=`${p}%`;}
export function hideProgress(prefix){document.getElementById(`${prefix}Progress`)?.classList.add("hidden");}
export function downloadPdf(data,fileName){const blob=data instanceof Blob?data:new Blob([data],{type:"application/pdf"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${sanitizeFileName(fileName)}.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
export function waitForGlobal(name,timeout=15000){return new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{if(window[name])return resolve(window[name]);if(Date.now()-start>=timeout)return reject(new Error(`A biblioteca ${name} não carregou. Verifique a conexão e recarregue a página.`));setTimeout(check,100);};check();});}
export function getFriendlyError(error){const message=String(error?.message||error||"Ocorreu um erro inesperado.");const lower=message.toLowerCase();if(lower.includes("failed to fetch")||lower.includes("networkerror"))return "Não foi possível acessar o serviço de conversão. Verifique a conexão e tente novamente.";if(lower.includes("encrypted")||lower.includes("password"))return "O documento parece estar protegido por senha. Remova a proteção e tente novamente.";if(lower.includes("payload too large")||lower.includes("request entity too large"))return "O arquivo excedeu o limite de envio desta versão.";return message;}
export function waitForPaint(){return new Promise(resolve=>setTimeout(resolve,20));}

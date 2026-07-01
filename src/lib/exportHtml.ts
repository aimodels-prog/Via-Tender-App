import html2pdf from 'html2pdf.js';

export async function downloadHtmlAsPdf(htmlContent: string, filename: string, asBlob: boolean = false) {
  const element = document.createElement('div');
  element.innerHTML = htmlContent;
  element.style.padding = '40px';
  element.style.fontFamily = 'Arial, sans-serif';
  
  const opt: any = {
    margin:       10,
    filename:     `${filename}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2 },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  if (asBlob) {
    return html2pdf().set(opt).from(element).output('blob');
  } else {
    html2pdf().set(opt).from(element).save();
  }
}

export function downloadHtmlAsDocx(htmlContent: string, filename: string) {
  const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${filename}</title>
<style>
  body, p, h1, h2, h3, h4, li, table, td, th {
    font-family: Arial, sans-serif !important;
  }
</style>
</head>
<body>`;
  const footer = `</body></html>`;
  const sourceHTML = header + htmlContent + footer;
  
  const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
  const fileDownload = document.createElement("a");
  document.body.appendChild(fileDownload);
  fileDownload.href = source;
  fileDownload.download = `${filename}.doc`;
  fileDownload.click();
  document.body.removeChild(fileDownload);
}

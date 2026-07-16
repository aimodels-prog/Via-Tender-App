import html2pdf from 'html2pdf.js';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function linearToSrgb(value: number) {
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.round(clamp01(encoded) * 255);
}

function oklabToRgba(lightness: number, a: number, b: number, alpha = 1) {
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  const red = linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return `rgba(${red}, ${green}, ${blue}, ${clamp01(alpha)})`;
}

function parseUnitValue(value: string, angle = false) {
  const token = value.trim().toLowerCase();
  if (!token || token === 'none') return 0;
  const numeric = Number.parseFloat(token);
  if (!Number.isFinite(numeric)) return 0;
  if (token.endsWith('%')) return numeric / 100;
  if (!angle) return numeric;
  if (token.endsWith('rad')) return numeric * (180 / Math.PI);
  if (token.endsWith('turn')) return numeric * 360;
  if (token.endsWith('grad')) return numeric * 0.9;
  return numeric;
}

function convertModernColor(value: string) {
  return value
    .replace(/oklch\(\s*([^)]*?)\s*\)/gi, (_match, body: string) => {
      const [channels, alphaValue] = body.split('/').map((part) => part.trim());
      const [lightnessValue = '0', chromaValue = '0', hueValue = '0'] = channels.split(/\s+/);
      const lightness = parseUnitValue(lightnessValue);
      const chroma = parseUnitValue(chromaValue);
      const hue = parseUnitValue(hueValue, true) * (Math.PI / 180);
      return oklabToRgba(
        lightness,
        chroma * Math.cos(hue),
        chroma * Math.sin(hue),
        alphaValue ? parseUnitValue(alphaValue) : 1,
      );
    })
    .replace(/oklab\(\s*([^)]*?)\s*\)/gi, (_match, body: string) => {
      const [channels, alphaValue] = body.split('/').map((part) => part.trim());
      const [lightnessValue = '0', aValue = '0', bValue = '0'] = channels.split(/\s+/);
      return oklabToRgba(
        parseUnitValue(lightnessValue),
        parseUnitValue(aValue),
        parseUnitValue(bValue),
        alphaValue ? parseUnitValue(alphaValue) : 1,
      );
    });
}

function sanitizeHtml2CanvasColors(clonedDocument: Document) {
  const root = clonedDocument.querySelector('.html2pdf__container') || clonedDocument.body;
  const elements = [root, ...Array.from(root.querySelectorAll('*'))].filter((element): element is HTMLElement | SVGElement =>
    element instanceof clonedDocument.defaultView!.HTMLElement || element instanceof clonedDocument.defaultView!.SVGElement,
  );
  const colorProperties = [
    'color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color',
    'border-left-color', 'outline-color', 'text-decoration-color', 'caret-color', 'fill', 'stroke',
  ];

  elements.forEach((element) => {
    const computed = clonedDocument.defaultView!.getComputedStyle(element);
    colorProperties.forEach((property) => {
      const value = computed.getPropertyValue(property);
      if (/oklch\(|oklab\(/i.test(value)) {
        element.style.setProperty(property, convertModernColor(value), 'important');
      }
    });
    const boxShadow = computed.getPropertyValue('box-shadow');
    const textShadow = computed.getPropertyValue('text-shadow');
    if (/oklch\(|oklab\(/i.test(boxShadow)) element.style.setProperty('box-shadow', 'none', 'important');
    if (/oklch\(|oklab\(/i.test(textShadow)) element.style.setProperty('text-shadow', 'none', 'important');
  });
}

export async function downloadHtmlAsPdf(htmlContent: string, filename: string, asBlob: boolean = false) {
  const element = document.createElement('div');
  element.innerHTML = htmlContent;
  element.style.padding = '40px';
  element.style.fontFamily = 'Arial, sans-serif';
  element.style.color = '#111827';
  element.style.backgroundColor = '#ffffff';
  
  const opt: any = {
    margin:       10,
    filename:     `${filename}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  {
      scale: 2,
      backgroundColor: '#ffffff',
      onclone: sanitizeHtml2CanvasColors,
    },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  if (asBlob) {
    return html2pdf().set(opt).from(element).output('blob');
  } else {
    return html2pdf().set(opt).from(element).save();
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

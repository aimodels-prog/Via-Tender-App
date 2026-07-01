export function generateCVHtml(expert: any, positionTitle: string = 'Expert'): string {
  if (!expert) return '';
  const fullName = expert.fullName || expert.name || 'Unknown Expert';
  
  const cleanStr = (s: any) => String(s || "").replace(/\r|\t|\u00A0/g, ' ');

  const educationArr = Array.isArray(expert.education) ? expert.education : typeof expert.education === 'string' ? [expert.education] : [];
  const softwareArr = Array.isArray(expert.software || expert.computer_skills) ? (expert.software || expert.computer_skills) : typeof (expert.software || expert.computer_skills) === 'string' ? [(expert.software || expert.computer_skills)] : [];
  const trainingArr = Array.isArray(expert.training || expert.training_courses || expert.courses) ? (expert.training || expert.training_courses || expert.courses) : [];
  const researchArr = Array.isArray(expert.research || expert.research_related || expert.highlights || expert.highlights_of_activities) ? (expert.research || expert.research_related || expert.highlights || expert.highlights_of_activities) : [];
  const languagesArr = Array.isArray(expert.languages) ? expert.languages : typeof expert.languages === 'string' ? [expert.languages] : [];

  let html = `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; color: #333;">
      <h1 style="text-align: center; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px;">${fullName}</h1>
      <p style="text-align: center; font-size: 1.1em; color: #64748b;"><strong>Proposed Position:</strong> ${positionTitle}</p>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <tbody>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; width: 30%;">DATE OF BIRTH:</td>
            <td style="padding: 8px 0;">${expert.birth_date || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">COUNTRY OF CITIZENSHIP:</td>
            <td style="padding: 8px 0;">${expert.nationality || 'N/A'}</td>
          </tr>
        </tbody>
      </table>

      <section style="margin-top: 20px;">
        <h2 style="color: #1e3a8a; font-size: 1.25em;">1. Profile Summary</h2>
        <p style="line-height: 1.6; white-space: pre-wrap;">${expert.profile_summary || expert.summary || expert.profileSummary || 'No summary provided.'}</p>
      </section>

      <section style="margin-top: 20px;">
        <h2 style="color: #1e3a8a; font-size: 1.25em;">2. Education</h2>
        <ul style="line-height: 1.6;">
          ${educationArr.length > 0 ? educationArr.map((edu: string) => `<li>${edu}</li>`).join('') : `<li>Details available upon request.</li>`}
        </ul>
      </section>
  `;

  if (softwareArr.length > 0) {
    html += `
      <section style="margin-top: 20px;">
        <h2 style="color: #1e3a8a; font-size: 1.25em;">3. Software / Computer Skills</h2>
        <ul style="line-height: 1.6;">
          ${softwareArr.map((s: string) => `<li>${s}</li>`).join('')}
        </ul>
      </section>
    `;
  }

  if (trainingArr.length > 0) {
    html += `
      <section style="margin-top: 20px;">
        <h2 style="color: #1e3a8a; font-size: 1.25em;">4. Training & Courses</h2>
        <ul style="line-height: 1.6;">
          ${trainingArr.map((t: string) => `<li>${t}</li>`).join('')}
        </ul>
      </section>
    `;
  }

  if (expert.employment_history && expert.employment_history.length > 0) {
    const hasProject = expert.employment_history.some((h: any) => h.project && !h.country);
    const col4Header = hasProject ? 'Project' : 'Country';

    let tableRows = '';
    expert.employment_history.forEach((h: any) => {
      tableRows += `
        <tr>
          <td style="border: 1px solid #cbd5e1; padding: 10px;">${cleanStr(h.start_date)} - ${cleanStr(h.end_date)}</td>
          <td style="border: 1px solid #cbd5e1; padding: 10px;">${cleanStr(h.organization || h.client)}</td>
          <td style="border: 1px solid #cbd5e1; padding: 10px;">${cleanStr(h.role)}</td>
          <td style="border: 1px solid #cbd5e1; padding: 10px;">${cleanStr(hasProject ? (h.project || h.client) : h.country)}</td>
          <td style="border: 1px solid #cbd5e1; padding: 10px; white-space: pre-wrap;">${cleanStr(h.description)}</td>
        </tr>
      `;
    });

    html += `
      <section style="margin-top: 20px;">
        <h2 style="color: #1e3a8a; font-size: 1.25em;">5. Employment Record</h2>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.9em;">
          <thead>
            <tr style="background-color: #f1f5f9;">
              <th style="border: 1px solid #cbd5e1; padding: 10px; text-align: left;">Period</th>
              <th style="border: 1px solid #cbd5e1; padding: 10px; text-align: left;">Employing Organization</th>
              <th style="border: 1px solid #cbd5e1; padding: 10px; text-align: left;">Title / Position</th>
              <th style="border: 1px solid #cbd5e1; padding: 10px; text-align: left;">${col4Header}</th>
              <th style="border: 1px solid #cbd5e1; padding: 10px; text-align: left;">Summary of Activities</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </section>
    `;
  }

  if (expert.adequacy_experience && expert.adequacy_experience.length > 0) {
    let rows = '';
    expert.adequacy_experience.forEach((item: any) => {
      rows += `<div style="margin-bottom: 15px; border-left: 3px solid #1e3a8a; padding-left: 15px;">`;
      if (item.period) rows += `<p style="margin: 0;"><strong>Period:</strong> ${item.period}</p>`;
      if (item.country) rows += `<p style="margin: 0;"><strong>Country:</strong> ${item.country}</p>`;
      if (item.position) rows += `<p style="margin: 0;"><strong>Position:</strong> ${item.position}</p>`;
      if (item.client) rows += `<p style="margin: 0;"><strong>Client:</strong> ${item.client}</p>`;
      if (item.assignment) rows += `<p style="margin: 0;"><strong>Assignment:</strong> ${item.assignment}</p>`;
      rows += `</div>`;
    });

    html += `
      <section style="margin-top: 20px;">
        <h2 style="color: #1e3a8a; font-size: 1.25em;">6. Adequacy for the Assignment</h2>
        ${rows}
      </section>
    `;
  }

  if (researchArr.length > 0) {
    html += `
      <section style="margin-top: 20px;">
        <h2 style="color: #1e3a8a; font-size: 1.25em;">7. Other Details / Research</h2>
        <ul style="line-height: 1.6;">
          ${researchArr.map((r: any) => `<li>${typeof r === 'string' ? r : (r.title ? r.title + ': ' + (r.description||'') : JSON.stringify(r))}</li>`).join('')}
        </ul>
      </section>
    `;
  }

  if (languagesArr.length > 0) {
    html += `
      <section style="margin-top: 20px;">
        <h2 style="color: #1e3a8a; font-size: 1.25em;">8. Language Skills</h2>
        <ul style="line-height: 1.6;">
          ${languagesArr.map((lang: string) => `<li>${lang}</li>`).join('')}
        </ul>
      </section>
    `;
  }

  if (expert.email || expert.phone) {
    html += `
      <section style="margin-top: 20px;">
        <h2 style="color: #1e3a8a; font-size: 1.25em;">9. Contact Information</h2>
        <p style="line-height: 1.6;">
          ${expert.email ? `<strong>Email:</strong> ${expert.email}<br />` : ''}
          ${expert.phone ? `<strong>Phone:</strong> ${expert.phone}` : ''}
        </p>
      </section>
    `;
  }

  html += `
      <p style="margin-top: 40px; font-size: 0.9em; color: #94a3b8; text-align: center;">
        <em>This document was generated automatically by the matching system.</em>
      </p>
    </div>
  `;

  return html;
}

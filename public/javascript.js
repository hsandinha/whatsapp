async function sendWhatsAppMessages() {
  const table = document.getElementById("myTable");
  const rows = table.getElementsByTagName("tr");

  const customers = [];

  for (let i = 1; i < rows.length; i++) {
    const rowData = rows[i].getElementsByTagName("td");

    const nome = rowData[0].innerText || "";
    const whatsapp = rowData[1].innerText || "";

    customers.push({ nome, whatsapp });
  }

  await fetch("/sendMessages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ customers }),
  });
}

function handleFile(event) {
  const file = event.target.files[0];

  const reader = new FileReader();
  reader.onload = function (e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    let html = '<table id="myTable">';
    for (let i = 0; i < jsonData.length; i++) {
      html += "<tr>";
      for (let j = 0; j < jsonData[i].length; j++) {
        html += "<td>" + (jsonData[i][j] || "") + "</td>";
      }
      html += "</tr>";
    }
    html += "</table>";

    document.getElementById("output").innerHTML = html;
  };
  reader.readAsArrayBuffer(file);
}

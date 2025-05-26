async function sendWhatsAppMessages() {
  try {
    const table = document.getElementById("myTable");
    const rows = table.getElementsByTagName("tr");

    const customers = [];

    for (let i = 1; i < rows.length; i++) {
      const rowData = rows[i].getElementsByTagName("td");

      const nome = rowData[0].innerText.trim();
      const whatsapp = rowData[1].innerText.trim();

      // Ignorar linhas com campos vazios
      if (!nome || !whatsapp) {
        console.warn(`Linha ${i} ignorada devido a campos vazios.`);
        continue;
      }

      customers.push({ nome, whatsapp });
    }

    if (customers.length === 0) {
      throw new Error("Nenhum cliente válido encontrado para enviar mensagens.");
    }

    // Simulação de envio de mensagens
    await fetch("/sendMessages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ customers }),
    });

    // Atualizar a tabela com "OK" após o envio
    for (let i = 1; i < rows.length; i++) {
      const rowData = rows[i].getElementsByTagName("td");
      const nome = rowData[0].innerText.trim();
      const whatsapp = rowData[1].innerText.trim();

      if (nome && whatsapp) {
        rowData[2].innerText = "OK";
      }
    }

    console.log("Mensagens enviadas com sucesso!");
  } catch (error) {
    console.error("Erro ao enviar mensagens:", error);
  }
}

function handleFile(event) {
  try {
    const file = event.target.files[0];
    if (!file) {
      throw new Error("Nenhum arquivo selecionado.");
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        // Criar cabeçalho da tabela
        let html = '<table id="myTable"><thead><tr><th>Nome</th><th>WhatsApp</th><th>Status</th></tr></thead><tbody>';
        for (let i = 0; i < jsonData.length; i++) {
          // Verificar se a linha está completamente vazia
          if (jsonData[i].every(cell => !cell)) {
            console.warn(`Linha ${i + 1} ignorada por estar vazia.`);
            continue;
          }

          html += "<tr>";
          for (let j = 0; j < jsonData[i].length; j++) {
            html += "<td>" + (jsonData[i][j] || "") + "</td>";
          }
          html += "<td></td>"; // Coluna para o status
          html += "</tr>";
        }
        html += "</tbody></table>";

        document.getElementById("output").innerHTML = html;
      } catch (error) {
        console.error("Erro ao processar o arquivo Excel:", error);
      }
    };
    reader.readAsArrayBuffer(file);
  } catch (error) {
    console.error("Erro ao ler o arquivo:", error);
  }
}

function handleFile(event) {
  try {
    const file = event.target.files[0];
    if (!file) {
      throw new Error("Nenhum arquivo selecionado.");
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        // Criar cabeçalho da tabela
        let html = '<table id="myTable"><thead><tr><th>Nome</th><th>WhatsApp</th><th>Status</th></tr></thead><tbody>';
        for (let i = 0; i < jsonData.length; i++) {
          // Verificar se a linha está completamente vazia
          if (jsonData[i].every(cell => !cell)) {
            console.warn(`Linha ${i + 1} ignorada por estar vazia.`);
            continue;
          }

          html += "<tr>";
          for (let j = 0; j < jsonData[i].length; j++) {
            html += "<td>" + (jsonData[i][j] || "") + "</td>";
          }
          html += "<td></td>"; // Coluna para o status
          html += "</tr>";
        }
        html += "</tbody></table>";

        document.getElementById("output").innerHTML = html;
      } catch (error) {
        console.error("Erro ao processar o arquivo Excel:", error);
      }
    };
    reader.readAsArrayBuffer(file);
  } catch (error) {
    console.error("Erro ao ler o arquivo:", error);
  }
}
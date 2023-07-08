function enviarMensagensWhatsApp() {
    var table = document.getElementById("myTable");
    var rows = table.getElementsByTagName("tr");
    
  
    for (var i = 1; i < rows.length; i++) { // Começando em 1 para ignorar o cabeçalho da tabela
      var rowData = rows[i].getElementsByTagName("td");
  
      var nome = rowData[0].innerText || "";
      var whatsapp = rowData[1].innerText || "";
  
      enviarWhatsApp(nome, whatsapp);
    }
  }
  
  
  function enviarWhatsApp(nome, whatsapp) {
    var mensagem = "Ola " + nome + ", Jato de Areia agradece  a nossa parceria. Segue nossa tabela!";
    

    var numeroTelefone = whatsapp;
    
    
    // URL da imagem a ser anexada
    var imagemUrl = "/img/Tabela.png";
    
    // Constrói o objeto de requisição
    var request = new XMLHttpRequest();
    var url = "https://web.whatsapp.com/send/?phone=" + numeroTelefone + "&text=" + encodeURIComponent(mensagem);
    url += "&source=" + encodeURIComponent(imagemUrl); // Adiciona a imagem à URL
    
    window.open(url);

    // Envia a requisição
    request.send();
  }


  function handleFile(event) {
    var files = event.target.files;
    var file = files[0];
    
    var reader = new FileReader();
    reader.onload = function(e) {
      var data = new Uint8Array(e.target.result);
      var workbook = XLSX.read(data, { type: 'array' });
      
      var sheetName = workbook.SheetNames[0];
      var worksheet = workbook.Sheets[sheetName];
      
      var jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      var html = '<table id="myTable">';
      for (var i = 0; i < jsonData.length; i++) {
        html += '<tr>';
        for (var j = 0; j < jsonData[i].length; j++) {
          html += '<td>' + (jsonData[i][j] || '') + '</td>';
        }
        html += '</tr>';
      }
      html += '</table>';
      
      document.getElementById('output').innerHTML = html;
    };
    reader.readAsArrayBuffer(file);
  }
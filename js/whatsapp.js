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
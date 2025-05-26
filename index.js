const express = require("express");
const puppeteer = require("puppeteer");
const bodyParser = require("body-parser");

const app = express();
const port = 3001;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.post("/sendMessages", async (req, res) => {
  try {
    function delay(time) {
      return new Promise(function (resolve) {
        setTimeout(resolve, time);
      });
    }

    const customers = req.body.customers;
    const maxAttempts = 1; // Número máximo de tentativas

    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    for (const customer of customers) {
      const message = `teste`;
      const url = `https://web.whatsapp.com/send?phone=${customer.whatsapp}&text=${message}`;

      let attempt = 0;
      let success = false;

      while (attempt < maxAttempts && !success) {
        try {
            page.setDefaultTimeout(0); // Evita timeouts antes de acessar a URL
            await page.goto(url, { waitUntil: 'networkidle2' });
    
            // Aguarda e clica no botão de envio
            await page.waitForSelector('button:has([data-icon="send"])', { timeout: 40000 });
            await page.click('button:has([data-icon="send"])');
            await new Promise(r => setTimeout(r, 4000));
    
            // Aguarda e clica no botão de anexar
            await page.waitForSelector('[aria-label="Anexar"]', { timeout: 40000 });
            await page.click('[aria-label="Anexar"]');
            await new Promise(r => setTimeout(r, 4000));
    
            // Aguarda pelo menu e clica em "Fotos e vídeos"
            await page.waitForXPath("//span[contains(text(), 'Fotos e vídeos')]", { timeout: 40000 });
            const [photoButton] = await page.$x("//span[contains(text(), 'Fotos e vídeos')]");
            if (photoButton) {
                await photoButton.click();
            } else {
                throw new Error("Botão de fotos e vídeos não encontrado");
            }
    
            // Espera pelo seletor de arquivo e faz o upload
            const [fileChooser] = await Promise.all([
                page.waitForFileChooser()
            ]);
            await fileChooser.accept(["./public/imagens/copa.jpg"]);
            await new Promise(r => setTimeout(r, 4000));
    
            // Aguarda e clica no botão de envio final
            await page.waitForSelector('button:has([data-icon="send"])', { visible: true, timeout: 40000 });
            await page.click('button:has([data-icon="send"])');
    
            success = true; // Se tudo correr bem, marca como sucesso
        } catch (error) {
            console.log(`Erro ao processar ${customer.whatsapp}: ${error.message}`);
            attempt++;
            if (attempt < maxAttempts) {
                console.log(`Tentando novamente (${attempt}/${maxAttempts})...`);
            } else {
                console.log(`Falha ao processar ${customer.whatsapp} após ${maxAttempts} tentativas.`);
            }
        }
    }
    
    }

    await browser.close(); // Fecha o navegador após processar todos os clientes
    res.send({ message: "ok" });
  } catch (err) {
    console.log(err);
    res.status(500).send({ error: "An error occurred while sending messages." });
  }
});

app.listen(port, () => console.log(`App listening on port ${port}!`));
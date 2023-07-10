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

    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
   

    for (const customer of customers) {
      const message = `Olá ${customer.nome}, Jato de Areia agradece  a nossa parceria. Segue nossa tabela!`;
      const url = `https://web.whatsapp.com/send?phone=${customer.whatsapp}&text=${message}`;

      await page.goto(url);
      page.setDefaultTimeout(0);

      await page.waitForSelector('[data-testid="send"]');
      await delay(2000);

      await page.waitForSelector('[data-testid="send"]');
      await page.click('[data-testid="send"]');
      await delay(2000);
      
      await page.waitForSelector('[data-testid="conversation-clip"]');
      await page.click('[data-testid="conversation-clip"]');
      await delay(2000);

      await page.waitForSelector('[data-testid="attach-image"]');
      await delay(2000);

      const [fileChooser] = await Promise.all([
        page.waitForFileChooser(),
        page.click('[data-testid="attach-image"]'),
      ]);
      await fileChooser.accept(["./public/imagens/Tabela.jpg"]);
      await delay(2000);

      await page.waitForSelector('[data-testid="send"]');
      await page.click('[data-testid="send"]');
      await delay(2000);
    }

    res.send({ message: "ok" });
  } catch (err) {
    console.log(err);
  }
});

app.listen(port, () => console.log(`App listening on port ${port}!`));
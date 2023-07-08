from selenium import webdriver
import time
import pandas as pd

# Carregar dados da planilha Excel
contatos_df = pd.read_excel('Y:\Contatos\Contatos.xlsx')  # Substitua pelo caminho correto do seu arquivo Excel
mensagem = "Boa tarde {nome}, nos do jato de Areia agradecemos nossa parceria de sempre, segue a nossa tabela de preço"
caminho_imagem = "D:\entrega\Tabela.png"  # Substitua pelo caminho correto da imagem que deseja enviar

# Inicializar o navegador
driver = webdriver.Firefox(executable_path='D:\entrega\geckodriver.exe')  # Substitua pelo caminho correto do seu geckodriver

# Abrir o WhatsApp Web
driver.get('https://web.whatsapp.com')
input("Faça o login no WhatsApp Web e pressione Enter para continuar...")  # Aguarda o login manual

# Enviar mensagens para os contatos
for contato in contatos_df['Contato']:
    # Abrir o chat do contato
    driver.get(f'https://web.whatsapp.com/send?phone={contato}')
    time.sleep(5)  # Aguarda a página carregar

    # Enviar a mensagem
    mensagem_box = driver.find_element_by_xpath('//div[@contenteditable="true"][@data-tab="1"]')
    mensagem_box.send_keys(mensagem)

    # Enviar a mensagem pressionando Enter
    enviar_button = driver.find_element_by_xpath('//span[@data-testid="send"]')
    enviar_button.click()

    # Aguardar antes de enviar a próxima mensagem
    time.sleep(2)

# Fechar o navegador
driver.quit()
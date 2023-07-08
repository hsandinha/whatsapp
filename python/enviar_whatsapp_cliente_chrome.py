from selenium import webdriver

# Caminho para o executável do ChromeDriver
chromedriver_path = 'D:\\mensagem\\chromedriver.exe'

# Configurar o driver do Chrome
driver = webdriver.Chrome(chromedriver_path)

# Abrir o site da Globo
driver.get('https://www.globo.com')

# Aguardar alguns segundos
driver.implicitly_wait(5)

# Fechar o navegador
driver.quit()
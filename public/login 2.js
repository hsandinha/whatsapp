// ═══════════════════════════════════════════════════════════════
// WhatsApp Sender Pro — Landing Page Auth (Supabase)
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://piigfztyhymxrcrpavwq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpaWdmenR5aHlteHJjcnBhdndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTkzNzQsImV4cCI6MjA4ODU3NTM3NH0.-nxRKReeM8blNKqw5kIEIHqolxRdOx800zwsmREOq4Y";

let supabaseClient = null;

// ═══════════════════════════════════════════════════════════════
// AUTH MODAL — Definido PRIMEIRO para que botões sempre funcionem
// ═══════════════════════════════════════════════════════════════
function showAuth(tab = "login") {
    const modal = document.getElementById("authModal");
    if (modal) {
        modal.style.display = "flex";
        switchAuthTab(tab);
    }
}

function closeAuth() {
    const modal = document.getElementById("authModal");
    if (modal) modal.style.display = "none";
    clearErrors();
}

function switchAuthTab(tab) {
    const tabLogin = document.getElementById("tabLogin");
    const tabRegister = document.getElementById("tabRegister");
    const formLogin = document.getElementById("formLogin");
    const formRegister = document.getElementById("formRegister");

    if (tabLogin) tabLogin.classList.toggle("active", tab === "login");
    if (tabRegister) tabRegister.classList.toggle("active", tab === "register");
    if (formLogin) formLogin.style.display = tab === "login" ? "block" : "none";
    if (formRegister) formRegister.style.display = tab === "register" ? "block" : "none";
    clearErrors();
}

function clearErrors() {
    ["loginError", "regError", "regSuccess"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = "none";
            el.style.color = "";
            el.style.background = "";
        }
    });
}

function showError(id, msg) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg;
        el.style.display = "block";
        el.style.color = "";
        el.style.background = "";
    }
}

function showSuccess(id, msg) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg;
        el.style.display = "block";
    }
}

// ═══════════════════════════════════════════════════════════════
// INICIALIZAÇÃO SEGURA DO SUPABASE
// ═══════════════════════════════════════════════════════════════
function initSupabase() {
    if (supabaseClient) return supabaseClient;
    if (typeof window.supabase === "undefined" || !window.supabase.createClient) {
        console.error("Supabase SDK não carregou. Verifique sua conexão.");
        return null;
    }
    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return supabaseClient;
    } catch (err) {
        console.error("Erro ao inicializar Supabase:", err);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// CHECK SESSION — Se já logado, redireciona
// ═══════════════════════════════════════════════════════════════
async function checkSession() {
    const sb = initSupabase();
    if (!sb) return;
    try {
        const { data: { session } } = await sb.auth.getSession();
        if (session) {
            window.location.href = "/app";
        }
    } catch (err) {
        console.warn("Erro ao verificar sessão:", err);
    }
}

// ═══════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════
async function doLogin() {
    clearErrors();
    const sb = initSupabase();
    if (!sb) return showError("loginError", "Erro de conexão com o servidor. Recarregue a página.");

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPass").value;

    if (!email || !password) {
        return showError("loginError", "Preencha email e senha.");
    }

    const btn = document.querySelector("#formLogin .auth-btn");
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Entrando...';

    try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });

        if (error) {
            const msgs = {
                "Invalid login credentials": "Email ou senha incorretos.",
                "Email not confirmed": "Confirme seu email antes de fazer login.",
            };
            showError("loginError", msgs[error.message] || error.message);
            return;
        }

        if (data.session) {
            window.location.href = "/app";
        }
    } catch (err) {
        showError("loginError", "Erro de conexão. Tente novamente.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Entrar';
    }
}

// ═══════════════════════════════════════════════════════════════
// REGISTER
// ═══════════════════════════════════════════════════════════════
async function doRegister() {
    clearErrors();
    const sb = initSupabase();
    if (!sb) return showError("regError", "Erro de conexão com o servidor. Recarregue a página.");

    const name = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPass").value;

    if (!name || !email || !password) {
        return showError("regError", "Preencha todos os campos.");
    }
    if (password.length < 6) {
        return showError("regError", "A senha precisa ter pelo menos 6 caracteres.");
    }

    const btn = document.querySelector("#formRegister .auth-btn");
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Criando conta...';

    try {
        const { data, error } = await sb.auth.signUp({
            email,
            password,
            options: {
                data: { name },
                emailRedirectTo: resolveAppUrl("/"),
            },
        });

        if (error) {
            const msgs = {
                "User already registered": "Este email já está registrado.",
                "Password should be at least 6 characters": "A senha precisa ter pelo menos 6 caracteres.",
            };
            showError("regError", msgs[error.message] || error.message);
            return;
        }

        if (data.user && !data.session) {
            showSuccess("regSuccess", "Conta criada! Verifique seu email para confirmar o cadastro.");
        } else if (data.session) {
            window.location.href = "/app";
        }
    } catch (err) {
        showError("regError", "Erro de conexão. Tente novamente.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rocket"></i> Criar Conta';
    }
}

// ═══════════════════════════════════════════════════════════════
// FORGOT PASSWORD
// ═══════════════════════════════════════════════════════════════
async function doForgotPassword() {
    const sb = initSupabase();
    if (!sb) return showError("loginError", "Erro de conexão. Recarregue a página.");

    const email = document.getElementById("loginEmail").value.trim();
    if (!email) {
        return showError("loginError", "Digite seu email acima primeiro, depois clique em 'Esqueci minha senha'.");
    }

    try {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + "/",
        });
        if (error) {
            showError("loginError", error.message);
        } else {
            const el = document.getElementById("loginError");
            if (el) {
                el.style.display = "block";
                el.style.color = "#25d366";
                el.style.background = "rgba(37,211,102,0.1)";
                el.textContent = "Email de recuperação enviado! Verifique sua caixa de entrada.";
            }
        }
    } catch {
        showError("loginError", "Erro ao enviar email de recuperação.");
    }
}

// ═══════════════════════════════════════════════════════════════
// CLOSE ON ESC / CLICK OUTSIDE
// ═══════════════════════════════════════════════════════════════
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAuth();
});

document.addEventListener("click", (e) => {
    if (e.target.classList.contains("auth-overlay")) closeAuth();
});

// ═══════════════════════════════════════════════════════════════
// INICIAR — Verifica sessão após tudo estar carregado
// ═══════════════════════════════════════════════════════════════
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkSession);
} else {
    checkSession();
}

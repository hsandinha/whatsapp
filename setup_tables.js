const { createClient } = require("@supabase/supabase-js");

const admin = createClient(
    "https://piigfztyhymxrcrpavwq.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpaWdmenR5aHlteHJjcnBhdndxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjk5OTM3NCwiZXhwIjoyMDg4NTc1Mzc0fQ.v5YY3v06aG9D7ggowdccqhg_fnYFerZ9vR53V1rr6so"
);

async function setup() {
    console.log("Verificando tabelas...");

    // Test if profiles table exists
    const { error: testErr } = await admin.from("profiles").select("id").limit(1);

    if (testErr && testErr.message.includes("Could not find")) {
        console.log("❌ Tabela 'profiles' NÃO existe.");
        console.log("");
        console.log("╔══════════════════════════════════════════════════════╗");
        console.log("║ AÇÃO NECESSÁRIA: Execute o SQL no Supabase          ║");
        console.log("╠══════════════════════════════════════════════════════╣");
        console.log("║ 1. Acesse: https://supabase.com/dashboard          ║");
        console.log("║ 2. Vá em: SQL Editor                                ║");
        console.log("║ 3. Cole o conteúdo do arquivo: supabase_setup.sql   ║");
        console.log("║ 4. Clique em RUN                                    ║");
        console.log("╚══════════════════════════════════════════════════════╝");
        console.log("");

        // Try inserting profiles for existing auth users as a workaround
        console.log("Tentando criar profiles para os auth users existentes...");
        const { data: authData } = await admin.auth.admin.listUsers();
        if (authData?.users) {
            for (const user of authData.users) {
                console.log(`  → ${user.email} (${user.id})`);
            }
        }
    } else {
        console.log("✅ Tabela 'profiles' existe!");

        // Check and insert profiles for users who don't have one
        const { data: authData } = await admin.auth.admin.listUsers();
        if (authData?.users) {
            for (const user of authData.users) {
                const { data: profile } = await admin
                    .from("profiles")
                    .select("id")
                    .eq("id", user.id)
                    .single();

                if (!profile) {
                    console.log(`Criando profile para ${user.email}...`);
                    const { error: insertErr } = await admin.from("profiles").insert({
                        id: user.id,
                        email: user.email,
                        name: user.user_metadata?.name || user.email.split("@")[0],
                        plan: "free",
                        daily_limit: 200,
                        is_admin: false,
                        status: "active",
                    });
                    if (insertErr) {
                        console.log(`  ❌ Erro: ${insertErr.message}`);
                    } else {
                        console.log(`  ✅ Profile criado`);
                    }
                } else {
                    console.log(`✅ ${user.email} já tem profile`);
                }
            }
        }
    }
}

setup()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });

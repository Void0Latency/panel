
// deployer.js - VoidLatency Deployer (Simple & Clean)
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === 'GET' && url.pathname === '/') {
            return new Response(getHtmlContent(), {
                headers: { 'Content-Type': 'text/html;charset=UTF-8' },
            });
        }

        if (request.method === 'POST' && url.pathname === '/api/deploy') {
            try {
                const { token } = await request.json();
                if (!token) throw new Error("❌ Please enter your Cloudflare token.");

                const headers = {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                };

                // 1. Get Account ID
                const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers });
                const accData = await accRes.json();
                if (!accData.success || accData.result.length === 0) {
                    throw new Error("❌ Invalid token. Could not find your Cloudflare account.");
                }
                const accountId = accData.result[0].id;

                // 2. Get or Create Subdomain
                let devSub = null;
                const subRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, { headers });
                const subData = await subRes.json();
                if (subData.success && subData.result.subdomain) {
                    devSub = subData.result.subdomain;
                } else {
                    const newSub = `void-${Math.random().toString(36).substring(2, 8)}`;
                    const createSub = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
                        method: 'PUT',
                        headers,
                        body: JSON.stringify({ subdomain: newSub })
                    });
                    const createSubData = await createSub.json();
                    if (!createSubData.success) throw new Error("❌ Failed to create subdomain.");
                    devSub = newSub;
                }

                // 3. Create D1 Database
                const uniqueSuffix = Math.random().toString(36).substring(2, 8);
                const workerName = `voidlatency-${uniqueSuffix}`;
                const dbName = `voidlatency-db-${uniqueSuffix}`;
                
                const dbRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ name: dbName })
                });
                const dbData = await dbRes.json();
                
                if (!dbData.success) {
                    const cfError = dbData.errors && dbData.errors.length > 0 ? dbData.errors[0].message : "Unknown";
                    throw new Error(`❌ Database creation failed: ${cfError}`);
                }
                const dbUuid = dbData.result.uuid;

                await new Promise(resolve => setTimeout(resolve, 1000));

                // 4. Get code from GitHub
                const githubRes = await fetch("https://raw.githubusercontent.com/Void0Latency/panel/main/voidlatency-core.js");
                if (!githubRes.ok) throw new Error("❌ Could not fetch panel code from GitHub.");
                const voidCode = await githubRes.text();

                // 5. Deploy Worker
                const metadata = {
                    main_module: "voidlatency-core.js",
                    compatibility_date: "2024-12-18",
                    bindings: [{ type: "d1", name: "VL_DB", id: dbUuid }]
                };

const formData = new FormData();
                formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
                formData.append("voidlatency-core.js", new Blob([voidCode], { type: "application/javascript+module" }), "voidlatency-core.js");

                const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
                    method: 'PUT',
                    headers: { "Authorization": `Bearer ${token}` },
                    body: formData
                });
                const deployData = await deployRes.json();
                
                if (!deployData.success) {
                    const cfError = deployData.errors && deployData.errors.length > 0 ? deployData.errors[0].message : "Unknown";
                    throw new Error(`❌ Deployment failed: ${cfError}`);
                }

                // 6. Enable Subdomain
                const routeRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ enabled: true })
                });
                
                if (!routeRes.ok) throw new Error("❌ Failed to enable subdomain.");

                // 7. Register the daily traffic-reset Cron Trigger (00:00 UTC = 03:30 Tehran).
                // The metadata upload can't carry triggers, so set them separately.
                try {
                    await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/schedules`, {
                        method: 'PUT',
                        headers,
                        body: JSON.stringify([{ cron: "0 0 * * *" }])
                    });
                } catch (e) { /* non-fatal: panel still works, scheduler just won't fire */ }

                // 8. Generate admin password and set it on the freshly deployed panel
                // so the password shown to the user is the real one.
                const adminPassword = generatePassword();
                const baseUrl = `https://${workerName}.${devSub}.workers.dev`;
                try {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    await fetch(`${baseUrl}/api/setup-password`, {
                        method: 'POST',
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ password: adminPassword })
                    });
                } catch (e) { /* non-fatal: user can set the password via the setup screen */ }

                const finalUrl = `${baseUrl}/panel`;

                return new Response(JSON.stringify({ 
                    success: true, 
                    url: finalUrl,
                    password: adminPassword,
                    workerName: workerName,
                    dbName: dbName
                }), {
                    headers: { 'Content-Type': 'application/json' }
                });

            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: error.message }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        return new Response("Not Found", { status: 404 });
    }
};

function generatePassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

function getHtmlContent() {
    return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VoidLatency Deployer</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <style>
        * { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { background: #0a0a0f; direction: ltr; }
        .glass { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.06); }
        .glow { box-shadow: 0 0 60px rgba(16, 185, 129, 0.15); }
        .gradient-text { background: linear-gradient(135deg, #34d399, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .btn-green { background: linear-gradient(135deg, #10b981, #059669); }
        .btn-green:hover { background: linear-gradient(135deg, #059669, #047857); transform: scale(1.02); }
        .animate-float { animation: float 6s ease-in-out infinite; }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
        .dark-blue-bg { background: #0d1b2a; }
        .dark-blue-card { background: rgba(13, 27, 42, 0.8); border: 1px solid rgba(255,255,255,0.06); }
        .dark-blue-input { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); }
        .dark-blue-input:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15); }
    </style>
</head>
<body class="min-h-screen flex flex-col justify-center items-center p-4 bg-[#0d1b2a]">

    <div class="max-w-md w-full glass rounded-3xl p-8 glow dark-blue-card relative z-10">
        <!-- Logo -->
        <div class="text-center mb-8">
            <div class="animate-float inline-block p-4 rounded-2xl bg-[#1a2744] border border-emerald-500/20 mb-4">
                <svg class="w-14 h-14 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
            </div>
            <h1 class="text-4xl font-black gradient-text mb-1">VoidLatency</h1>
            <p class="text-zinc-400 text-sm font-medium">Deploy your VPN panel in seconds</p>
        </div>

        <!-- Token Button -->
        <a href="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_subdomain%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=*&zoneId=all&name=VoidLatency-Deployer" 
           target="_blank" class="block text-center w-full py-3.5 bg-[#1a2744] hover:bg-[#243b5a] text-emerald-400 font-semibold rounded-xl transition border border-emerald-500/20 mb-4 text-sm">
            🔑 Get Cloudflare Token
        </a>

        <!-- Token Input -->
        <input type="password" id="apiToken" placeholder="Paste your Cloudflare token here..." 
               class="w-full px-4 py-3.5 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition dark-blue-input mb-4" 
               autocomplete="off" spellcheck="false">

        <!-- Deploy Button -->
        <button id="deployBtn" onclick="startDeploy()" 
                class="w-full py-3.5 btn-green text-white font-bold rounded-xl transition text-sm shadow-lg shadow-emerald-500/25">
            🚀 Deploy Panel
        </button>

<!-- Status -->
        <div id="status-container" class="mt-4 hidden">
            <div id="status-text" class="text-sm text-zinc-400 text-center mb-2">Starting deployment...</div>
            <div class="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
                <div id="progressBar" class="bg-emerald-500 h-1 rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
        </div>

        <!-- Error -->
        <div id="error-box" class="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm text-center hidden"></div>

        <!-- Success -->
        <div id="success-box" class="mt-4 hidden">
            <div class="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
                <p class="text-emerald-400 font-bold text-sm mb-2">✅ Panel Deployed Successfully!</p>
                <p class="text-zinc-400 text-xs mb-1">🔗 Your Panel URL:</p>
                <code id="panel-url" class="block bg-[#0d1b2a] p-2 rounded text-emerald-400 text-xs font-mono break-all mb-2">-</code>
                <p class="text-zinc-400 text-xs mb-1">🔑 Admin Password:</p>
                <code id="admin-password" class="block bg-[#0d1b2a] p-2 rounded text-emerald-400 text-xs font-mono break-all mb-3">-</code>
                <div class="flex flex-col gap-2">
                    <a href="#" id="panel-link" target="_blank" class="w-full py-2.5 btn-green text-white font-bold rounded-xl transition text-sm">🌐 Open Panel</a>
                    <button onclick="copyText('panel-url')" class="w-full py-2 bg-[#1a2744] hover:bg-[#243b5a] text-zinc-300 font-medium rounded-xl transition text-sm border border-zinc-700/50">📋 Copy URL</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Footer -->
    <div class="mt-6 flex gap-4 text-xs text-zinc-500">
        <a href="https://github.com/Void0Latency/panel" target="_blank" class="hover:text-zinc-300 transition">GitHub</a>
        <span>•</span>
        <a href="https://t.me/VoidLatency" target="_blank" class="hover:text-zinc-300 transition">Telegram</a>
        <span>•</span>
        <span>@VoidLatency</span>
    </div>

    <script>
        function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

        function copyText(elementId) {
            const el = document.getElementById(elementId);
            const text = el.innerText;
            navigator.clipboard.writeText(text).then(() => {
                const btn = event.target;
                const original = btn.innerText;
                btn.innerText = '✅ Copied!';
                setTimeout(() => btn.innerText = original, 2000);
            }).catch(() => {
                alert('📋 Copy manually: ' + text);
            });
        }

        async function startDeploy() {
            const token = document.getElementById('apiToken').value.trim();
            const btn = document.getElementById('deployBtn');
            const statusContainer = document.getElementById('status-container');
            const statusText = document.getElementById('status-text');
            const progressBar = document.getElementById('progressBar');
            const errorBox = document.getElementById('error-box');
            const successBox = document.getElementById('success-box');
            
            successBox.style.display = 'none';
            errorBox.style.display = 'none';
            
            if(!token) {
                errorBox.style.display = 'block';
                errorBox.innerText = '❌ Please enter your Cloudflare token first.';
                return;
            }
            
            btn.disabled = true;
            btn.innerText = '⏳ Deploying...';
            statusContainer.style.display = 'block';

const steps = [
                { text: '🔍 Validating token...', pct: 15 },
                { text: '🔗 Connecting to Cloudflare...', pct: 30 },
                { text: '📦 Creating database...', pct: 50 },
                { text: '📤 Uploading panel code...', pct: 70 },
                { text: '🌐 Deploying worker...', pct: 85 },
                { text: '⚡ Finalizing...', pct: 95 }
            ];

            for (const step of steps) {
                statusText.innerText = step.text;
                progressBar.style.width = step.pct + '%';
                await sleep(400);
            }

            try {
                const response = await fetch('/api/deploy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    progressBar.style.width = '100%';
                    statusText.innerText = '✅ Deployment complete! 100%';
                    await sleep(400);

                    statusContainer.style.display = 'none';
                    
                    document.getElementById('panel-url').innerText = result.url;
                    document.getElementById('admin-password').innerText = result.password;
                    document.getElementById('panel-link').href = result.url;
                    
                    successBox.style.display = 'block';
                    successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    throw new Error(result.error);
                }
            } catch(e) {
                statusContainer.style.display = 'none';
                errorBox.style.display = 'block';
                errorBox.innerText = '❌ ' + e.message;
            } finally {
                btn.disabled = false;
                btn.innerText = '🚀 Deploy Panel';
            }
        }

        document.getElementById('apiToken').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') startDeploy();
        });
    <\/script>
</body>
</html>
    `;
}
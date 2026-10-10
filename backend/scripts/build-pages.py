# Génère les pages du site à partir d'une coquille commune (menu, colonne, tendances).
# Usage : python3 scripts/build-pages.py   (depuis backend/)
import pathlib
PUB = pathlib.Path(__file__).resolve().parent.parent / "public"

P = {
 "home": '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
 "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
 "coins": '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.2A6 6 0 1 1 9.2 15.5"/>',
 "plus": '<path d="M12 5v14M5 12h14"/>',
 "image": '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
 "back": '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
 "feather": '<path d="M20 4c-7 0-12 5-13 12l-3 4"/><path d="M7 16h6c4 0 6-4 7-8"/>',
 "share": '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
 "buy": '<path d="M4 7h16l-1.5 9.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
 "copy": '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
}
def i(name, cls=""):
    return f'<svg class="i {cls}" viewBox="0 0 24 24" aria-hidden="true">{P[name]}</svg>'

def page(script, content):
    return f'''<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<!--META-->
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&display=swap">
<link rel="stylesheet" href="/static/app.css">
<script src="/static/app.js" defer></script>
{f'<script src="/static/{script}" defer></script>' if script else ""}
</head>
<body>
<div class="app">
  <aside class="side-nav" aria-label="Menu">
    <a class="brand" href="/" aria-label="XLaunch, accueil"><span class="brand-mark"></span><span class="brand-name">XLaunch</span></a>
    <a class="nav-link" data-nav href="/">{i("home")}<span>Accueil</span></a>
    <a class="nav-link" data-nav href="/explore">{i("search")}<span>Explorer</span></a>
    <a class="nav-link" data-nav href="/me">{i("coins")}<span>Mes gains</span></a>
    <a class="btn btn-launch" href="/#compose" aria-label="Lancer un token">{i("feather")}<span class="lbl">Lancer un token</span></a>
    <div class="side-me" data-auth></div>
  </aside>

  <main class="column">
    <div class="mtop"><a class="brand" href="/"><span class="brand-mark"></span>XLaunch</a><div data-auth></div></div>
{content}
  </main>

  <aside class="side-right" aria-label="Tendances">
    <div class="side-right-inner">
      <form class="search" action="/explore" role="search">{i("search","sm")}<input name="q" placeholder="Chercher un token, un $ticker, un @créateur" aria-label="Chercher un token"></form>
      <section class="box"><h2>Tendances</h2><div data-trends></div><a class="box-more" href="/explore?sort=volume">Voir plus</a></section>
      <section class="box"><h2>En chiffres</h2><div class="stats-box" data-stats></div></section>
      <p class="legal">Tokens spéculatifs sur Base : ne mise que ce que tu peux perdre. 100 % de la supply dans une pool Uniswap verrouillée, gas offert.</p>
    </div>
  </aside>
</div>
<nav class="tabbar" aria-label="Navigation">
  <a data-nav href="/" aria-label="Accueil">{i("home")}</a>
  <a data-nav href="/explore" aria-label="Explorer">{i("search")}</a>
  <a data-nav href="/me" aria-label="Mes gains">{i("coins")}</a>
</nav>
<a class="fab" href="/#compose" aria-label="Lancer un token">{i("plus")}</a>
</body>
</html>
'''

HOME = f'''    <div class="col-head">
      <div class="col-title"><h1>Accueil</h1></div>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" data-feed="new"><span>Récents</span></button>
        <button type="button" role="tab" aria-selected="false" data-feed="volume"><span>Tendances</span></button>
      </div>
    </div>

    <form class="compose" id="compose" novalidate>
      <div class="coin" id="coin" style="--s:48px;--h:220" aria-hidden="true">$</div>
      <div class="compose-main">
        <input class="compose-name" id="name" maxlength="32" placeholder="Quel token tu lances ?" autocomplete="off" aria-label="Nom du token">
        <div class="compose-row">
          <label class="ticker-wrap"><b>$</b><input class="ticker-input" id="symbol" maxlength="10" placeholder="TICKER" autocomplete="off" aria-label="Ticker"></label>
          <button type="button" class="pairtag" id="pairNow" title="Changer la paire">ETH</button>
        </div>
        <textarea class="compose-desc" id="description" maxlength="280" rows="1" placeholder="Dis-en plus (optionnel)" aria-label="Description"></textarea>
        <div class="compose-logo" id="logoPrev" hidden><img id="logoImg" alt="Logo du token"><button type="button" class="btn quiet small" id="logoRm">Retirer</button></div>
        <fieldset class="pairs" id="pairBox" hidden>
          <legend>Apparier avec : les acheteurs paieront dans cet actif, et tes frais arriveront dedans.</legend>
          <div id="pairs"><span class="mute">Chargement des paires…</span></div>
          <small class="compose-hint" id="pairHint"></small>
        </fieldset>
        <div class="notice" id="formMsg" role="alert" hidden></div>
        <div class="compose-bar">
          <label class="icon-btn" title="Ajouter un logo">{i("image")}<input type="file" id="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Ajouter un logo"></label>
          <button type="button" class="icon-btn" id="pairToggle" title="Choisir la paire" aria-expanded="false" aria-controls="pairBox">{i("coins")}</button>
          <span class="grow compose-hint" id="quota"></span>
          <span class="compose-hint" id="chars"></span>
          <button class="btn" type="submit" id="launchBtn">Lancer</button>
        </div>
      </div>
    </form>

    <div class="compose" id="done" hidden>
      <span id="doneCoin"></span>
      <div class="compose-main">
        <div style="font-size:21px;font-weight:800" id="doneTitle"></div>
        <div class="mute">Ton token est en ligne et déjà échangeable. Partage-le : chaque trade te rapporte <span data-fee-share>la moitié</span> des frais.</div>
        <div class="compose-row">
          <a class="btn" id="doneShare" target="_blank" rel="noopener"></a>
          <a class="btn quiet" id="donePage">Voir le token</a>
          <button class="btn quiet" type="button" id="doneAgain">Lancer un autre</button>
        </div>
      </div>
    </div>

    <div id="feed" aria-live="polite"></div>
    <div class="feed-empty" id="feedEmpty" hidden><b>Aucun token pour l'instant</b>Le premier, c'est peut-être le tien.</div>
    <div class="more"><button class="btn quiet" type="button" id="more" hidden>Afficher plus</button></div>'''

EXPLORE = f'''    <div class="col-head">
      <div class="col-title">
        <form class="search" style="flex:1" id="qform" role="search">{i("search","sm")}<input id="q" type="search" placeholder="Chercher un token, un $ticker, un @créateur, une paire" autocomplete="off" aria-label="Chercher un token"></form>
      </div>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" data-sort="new"><span>Nouveaux</span></button>
        <button type="button" role="tab" aria-selected="false" data-sort="volume"><span>Tendances</span></button>
        <button type="button" role="tab" aria-selected="false" data-sort="mcap"><span>Market cap</span></button>
      </div>
    </div>
    <div id="list"></div>
    <div class="feed-empty" id="empty" hidden></div>
    <div class="more"><button class="btn quiet" type="button" id="more" hidden>Afficher plus</button></div>'''

TOKEN = f'''    <div class="col-head">
      <div class="col-title"><a class="back" href="/" aria-label="Retour">{i("back")}</a><div><h1 id="hTitle">Token</h1><div class="sub" id="hSub"></div></div></div>
    </div>
    <article class="detail">
      <div class="detail-head"><span id="cAvatar"></span><div><b id="cName"></b><div class="mute" id="cHandle"></div></div></div>
      <p class="detail-text" id="tDesc" hidden></p>
      <div class="detail-card">
        <div class="detail-top"><span id="tCoin"></span><div><h2 id="tTitle">Chargement…</h2><div class="mute" id="tSub"></div></div></div>
        <dl class="kpis">
          <div class="kpi"><dt>Market cap</dt><dd id="kMcap">—</dd></div>
          <div class="kpi"><dt>Prix</dt><dd id="kPrice">—</dd></div>
          <div class="kpi"><dt>24 h</dt><dd id="kChange">—</dd></div>
          <div class="kpi"><dt>Volume 24 h</dt><dd id="kVol">—</dd></div>
        </dl>
      </div>
      <div class="detail-meta" id="tMeta"></div>
      <div class="detail-actions">
        <a class="btn" id="tBuy" target="_blank" rel="noopener">{i("buy","sm")}<span>Acheter</span></a>
        <a class="btn quiet" id="tShare" target="_blank" rel="noopener">{i("share","sm")}Partager</a>
        <button class="btn quiet" type="button" id="tCopy">{i("copy","sm")}Copier l'adresse</button>
      </div>
    </article>
    <section class="section"><h2 id="chartTitle">Prix</h2><div class="chart" id="chart" role="img" aria-label="Graphique du prix"></div></section>
    <section class="section">
      <h2>À propos</h2>
      <dl class="facts">
        <div><dt>Paire</dt><dd id="fPair"></dd></div>
        <div><dt>Contrat</dt><dd><a id="fAddr" target="_blank" rel="noopener"></a></dd></div>
        <div><dt>Pool</dt><dd><a id="fPool" target="_blank" rel="noopener"></a></dd></div>
        <div><dt>Supply</dt><dd>1 000 000 000, 100 % dans la pool</dd></div>
        <div><dt>Frais de trading</dt><dd>1 %, dont <span data-fee-share>la moitié</span> pour le créateur</dd></div>
        <div><dt>Liquidité</dt><dd>Verrouillée à vie</dd></div>
        <div><dt>Gagné par le créateur</dt><dd id="fFees">—</dd></div>
      </dl>
    </section>
    <div class="col-title" style="border-bottom:1px solid var(--line)"><h1 style="font-size:18px">Trades</h1><span class="sub" id="tradeCount"></span></div>
    <div id="trades"></div>
    <div class="feed-empty" id="noTrades" hidden><b>Aucun trade pour l'instant</b>Le premier acheteur obtient le prix de départ.</div>'''

ME = f'''    <div class="col-head">
      <div class="col-title"><a class="back" href="/" aria-label="Retour">{i("back")}</a><div><h1 id="pTitle">Mes gains</h1><div class="sub" id="pSub"></div></div></div>
    </div>

    <div class="feed-empty" id="loggedOut" hidden>
      <b>Connecte ton compte X</b>Tes gains sont rattachés à ton compte X. Connecte-toi pour les voir et les récupérer.
      <div style="margin-top:16px"><button class="btn ink" type="button" id="meLogin"></button></div>
    </div>

    <div id="loggedIn" hidden>
      <div class="banner" aria-hidden="true"></div>
      <div class="profile">
        <div class="profile-row"><span id="pAvatar"></span><a class="btn quiet small" style="margin-top:12px" id="pX" target="_blank" rel="noopener">Profil X</a></div>
        <h1 id="pName"></h1><div class="mute" id="pHandle"></div>
        <div class="profile-stats"><span><b id="sEarned">—</b> gagnés</span><span><b id="sTokens">0</b> tokens lancés</span></div>
      </div>
      <div class="tabs" role="tablist" style="border-bottom:1px solid var(--line)">
        <button type="button" role="tab" aria-selected="true" data-tab="gains"><span>Gains</span></button>
        <button type="button" role="tab" aria-selected="false" data-tab="tokens"><span>Mes tokens</span></button>
      </div>

      <section id="tab-gains" class="section" style="border-bottom:0">
        <div class="mute">Gagné au total, estimation sur tous les trades de tes tokens</div>
        <div class="earned" id="earned">—</div>
        <div class="escrow-list" id="escrow" style="margin-top:12px"></div>
        <p class="mute" id="escrowNote" style="margin:8px 0 16px"></p>
        <form class="claim-form" id="claimForm" novalidate>
          <label class="field"><span>Adresse qui reçoit tes gains</span>
            <input class="input" id="recipient" placeholder="0x…" autocomplete="off" spellcheck="false">
            <small>Une adresse sur Base (Coinbase Wallet, MetaMask, Rabby…). Vérifie-la bien : un envoi est définitif.</small>
          </label>
          <div class="notice" id="claimMsg" role="alert" hidden></div>
          <button class="btn" type="submit" id="claimBtn">Récupérer mes gains</button>
          <small class="mute">Le gas est offert. Ensuite, tes gains futurs arrivent directement sur cette adresse.</small>
        </form>

        <div id="faucet" hidden style="margin-top:28px;padding-top:16px;border-top:1px solid var(--line)">
          <h2 style="font-size:18px;margin:0 0 6px">Actions de test</h2>
          <p class="mute" style="margin:0 0 12px">Sur le testnet, les actions tokenisées sont des actions de test sans valeur. Reçois-en 10 de chaque pour essayer d'acheter des tokens appariés à une action.</p>
          <form class="claim-form" id="faucetForm" novalidate>
            <input class="input" id="faucetAddr" placeholder="Ton adresse Base Sepolia (0x…)" autocomplete="off" spellcheck="false" aria-label="Ton adresse Base Sepolia">
            <div class="notice" id="faucetMsg" role="status" hidden></div>
            <button class="btn quiet" type="submit" id="faucetBtn">Recevoir des actions de test</button>
          </form>
        </div>
      </section>

      <section id="tab-tokens" hidden>
        <div id="mine"></div>
        <div class="feed-empty" id="mineEmpty" hidden><b>Aucun token lancé</b>Ton premier token est à un post de là.<div style="margin-top:14px"><a class="btn" href="/#compose">Lancer mon token</a></div></div>
      </section>
    </div>'''

NOTFOUND = f'''    <div class="col-head"><div class="col-title"><a class="back" href="/" aria-label="Retour">{i("back")}</a><h1>Introuvable</h1></div></div>
    <div class="feed-empty"><b>Cette page n'existe pas</b>Cette adresse ne correspond à aucune page ni à aucun token XLaunch.<div style="margin-top:14px"><a class="btn" href="/explore">Explorer les tokens</a></div></div>'''

for name, script, content in [("index", "home.js", HOME), ("explore", "explore.js", EXPLORE), ("token", "token.js", TOKEN), ("me", "me.js", ME), ("404", None, NOTFOUND)]:
    (PUB / f"{name}.html").write_text(page(script, content))
print("pages générées")

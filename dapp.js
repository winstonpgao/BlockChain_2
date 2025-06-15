const marketAddress = "0x8Cb9C97db4eDF9C55A6ccA5Af609c08ac4113F79";

const dApp = {
  async init() {
    if (window.ethereum) {
      window.web3 = new Web3(window.ethereum);
      await window.ethereum.enable();
    } else {
      alert("Please install MetaMask!");
      return;
    }

    this.account = (await web3.eth.getAccounts())[0];
    this.logEvent("Connected as " + this.account);

    this.marketABI = await (await fetch("./CopyrightMarket.json")).json();
    this.auctionABI = await (await fetch("./CopyrightAuction.json")).json();
    this.market = new web3.eth.Contract(this.marketABI, marketAddress, { from: this.account });

    this.copyrights = [];
    await this.fetchAllCopyrights();
    await this.updateProprietaryCopyrights();
  },

  logEvent(msg) {
    $("#event-log").prepend(`<div>${msg}</div>`);
  },

  async fetchAllCopyrights() {
    // Scan Copyright events for all IDs
    let events = await this.market.getPastEvents('Copyright', { fromBlock: 0, toBlock: 'latest' });
    let unique = {};
    events.forEach(ev => unique[ev.returnValues.copyright_id] = ev.returnValues.reference_uri);
    this.copyrights = Object.entries(unique); // [[id, uri], ...]

    // UI: list as clickable chips
    let html = '';
    for (let [id] of this.copyrights) {
      html += `<span class="copyright-chip" onclick="dApp.selectCopyright('${id}')">${id}</span>`;
    }
    $("#copyright-list").html(html);

    // Auto-select latest/newest
    if (this.copyrights.length > 0) {
      this.selectCopyright(this.copyrights[this.copyrights.length-1][0]);
    }
  },

  async selectCopyright(id) {
    $(".copyright-chip").removeClass("selected");
    $(`.copyright-chip:contains('${id}')`).addClass("selected");

    let idx = this.copyrights.findIndex(([cid]) => cid == id);
    let reference_uri = idx >= 0 ? this.copyrights[idx][1] : "";
    let meta = {};
    try {
      if (reference_uri) {
        let resp = await fetch(`https://gateway.pinata.cloud/ipfs/${reference_uri.replace("ipfs://", "")}`);
        meta = await resp.json();
      }
    } catch (e) { meta = {}; }

    // Auction info
    let owner, uri;
    try {
      let data = await this.market.methods.copyrights(id).call();
      owner = data.owner;
      uri = data.uri;
    } catch(e) { owner = ""; uri = ""; }
    let highestBid = 0;
    let auctionEnded = false;
    let statusStr = "";
    try {
      highestBid = await this.market.methods.highestBid(id).call();
      auctionEnded = await this.market.methods.auctionEnded(id).call();
      statusStr = auctionEnded ? "<span style='color:#FF9292'>Ended</span>" : "<span style='color:#64ffda'>Ongoing</span>";
    } catch(e) {}

    // Withdraw message logic
    $("#withdraw-msg").text('');
    $("#withdraw-btn").prop('disabled', !auctionEnded);
    if (!auctionEnded) {
      $("#withdraw-msg").text("Withdraw can only be called after auction ends.");
    } else {
      $("#withdraw-msg").text("Auction ended: Withdraw is available.");
    }

    let html = `
      <div><b>ID:</b> ${id}</div>
      <div><b>Owner:</b> <span style="color:#87f7d7">${owner}</span></div>
      <div><b>Metadata:</b> ${meta.pinataContent ?
        `<br>&nbsp;&nbsp;Name: <b>${meta.pinataContent.name}</b>
        <br>&nbsp;&nbsp;Description: ${meta.pinataContent.description}
        <br>&nbsp;&nbsp;Image: <br><img src="https://gateway.pinata.cloud/ipfs/${meta.pinataContent.image.replace("ipfs://","")}" style="max-width:260px; margin:5px 0; border-radius:10px; box-shadow:0 2px 8px #00ffd5cc;">`
        : "(none / not loaded)"}
      </div>
      <div><b>Highest Bid:</b> <span style="color:#ffd35b">${web3.utils.fromWei(highestBid.toString(),"ether")}</span> ETH</div>
      <div><b>Auction Status:</b> ${statusStr}</div>
    `;
    $("#auction-info").html(html);
  },

  async createCopyright() {
    const name = $("#copyright-name").val();
    const description = $("#copyright-description").val();
    const imageInput = document.getElementById("copyright-image");
    const key = $("#pinata-api-key").val();
    const secret = $("#pinata-secret").val();

    if (!name || !description || !imageInput.files.length || !key || !secret) {
      alert("Please complete the form!");
      return;
    }

    // Upload image
    const form = new FormData();
    form.append("file", imageInput.files[0]);
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    this.logEvent("Uploading image to IPFS...");
    const imgRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        pinata_api_key: key,
        pinata_secret_api_key: secret
      },
      body: form
    });
    const imgHash = await imgRes.json();
    const imageURI = `ipfs://${imgHash.IpfsHash}`;
    this.logEvent("Image: " + imageURI);

    // Upload metadata
    this.logEvent("Uploading metadata...");
    const meta = {
      pinataContent: { name, description, image: imageURI },
      pinataOptions: { cidVersion: 1 }
    };
    const jsonRes = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        pinata_api_key: key,
        pinata_secret_api_key: secret
      },
      body: JSON.stringify(meta)
    });
    const jsonHash = await jsonRes.json();
    const referenceURI = `ipfs://${jsonHash.IpfsHash}`;
    this.logEvent("Reference URI: " + referenceURI);

    // Send to blockchain
    await this.market.methods.createCopyright(referenceURI).send();
    this.logEvent("createCopyright() transaction mined");
    await this.fetchAllCopyrights();
    await this.updateProprietaryCopyrights();
  },

  async createAuction() {
    const id = $("#auction-copyright-id").val();
    if (!id) { alert("Enter a Copyright ID"); return; }
    await this.market.methods.createAuction(id).send();
    this.logEvent(`Auction created for ID ${id}`);
    this.selectCopyright(id);
  },

  async bid() {
    const id = $("#bid-copyright-id").val();
    const amt = $("#bid-amount").val();
    if (!id || !amt) { alert("Enter ID and bid amount"); return; }
    await this.market.methods.bid(id).send({ value: web3.utils.toWei(amt, "ether") });
    this.logEvent(`Placed bid of ${amt} ETH on auction ${id}`);
    this.selectCopyright(id);
  },

  async endAuction() {
    const id = $("#end-copyright-id").val();
    if (!id) { alert("Enter a Copyright ID"); return; }
    await this.market.methods.endAuction(id).send();
    this.logEvent(`Auction ${id} ended`);
    this.selectCopyright(id);
  },

  async withdraw() {
    const id = $("#withdraw-copyright-id").val();
    if (!id) { alert("Enter a Copyright ID"); return; }
    // Fetch the auction contract address
    const addr = await this.market.methods.auctions(id).call();
    const auction = new web3.eth.Contract(this.auctionABI, addr, { from: this.account });
    await auction.methods.withdraw().send();
    this.logEvent(`Withdraw called on auction ${id}`);
  },

  // Proprietary Copyrights Section (Collapsible)
  async updateProprietaryCopyrights() {
    $("#dapp-copyrights").html('');
    let i = 1, empty = 0;
    const maxEmpty = 5;
    while (empty < maxEmpty) {
      try {
        const work = await this.market.methods.copyrights(i).call();
        if (work && work.owner && work.uri && work.owner !== "0x0000000000000000000000000000000000000000") {
          empty = 0;
          let meta = {};
          try {
            let resp = await fetch(`https://gateway.pinata.cloud/ipfs/${work.uri.replace("ipfs://", "")}`);
            meta = await resp.json();
          } catch {}
          let name = meta?.pinataContent?.name || meta?.name || "";
          let desc = meta?.pinataContent?.description || meta?.description || "";
          let img = meta?.pinataContent?.image || meta?.image || "";
          let imgTag = img ? `<img src="https://gateway.pinata.cloud/ipfs/${img.replace('ipfs://', '')}" style="width:100%;max-width:320px; margin-top:8px;border-radius:10px;">` : '';
          let ref = work.uri ? `<a href="https://gateway.pinata.cloud/ipfs/${work.uri.replace('ipfs://','')}" target="_blank">${work.uri}</a>` : '';

          const itemHtml = `
            <li>
              <div class="collapsible-header"><i class="far fa-copyright"></i> Copyright #${i}: ${name}</div>
              <div class="collapsible-body">
                <b>Description:</b> ${desc}<br/>
                ${imgTag}
                <div style="margin-top:6px;"><b>Owner:</b> ${work.owner}</div>
                <div><b>Reference:</b> ${ref}</div>
              </div>
            </li>
          `;
          $("#dapp-copyrights").append(itemHtml);
        } else {
          empty++;
        }
      } catch {
        empty++;
      }
      i++;
    }
    $('.collapsible').collapsible();
  }
};

window.addEventListener("load", () => dApp.init());

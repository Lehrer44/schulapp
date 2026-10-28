const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const handlers={},nodes={};let footerTag;const document={body:{append(el){nodes[el.id]=el}},createElement(tag){footerTag=tag;return {dataset:{},setAttribute(){},textContent:''}},getElementById(id){return nodes[id]||null},addEventListener(name,cb){handlers[name]=cb}};
const window={addEventListener(name,cb){handlers[name]=cb}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../shared/connection-status.js'),'utf8'),{window,document});
handlers.DOMContentLoaded();assert.equal(footerTag,'footer');window.setConnectionStatus('ready','Antwort gespeichert.');assert.equal(nodes.connectionStatus.dataset.state,'ready');
handlers.offline();assert.equal(nodes.connectionStatus.dataset.state,'error');assert(nodes.connectionStatus.textContent.includes('noch nicht gespeichert'));
handlers.online();assert.equal(nodes.connectionStatus.dataset.state,'waiting');assert(!nodes.connectionStatus.textContent.includes('gespeichert'));
window.setConnectionStatus('ready','Stand bestätigt.');assert.equal(nodes.connectionStatus.textContent,'Stand bestätigt.');
console.log('PASS: offline and reconnect never claim a successful save');


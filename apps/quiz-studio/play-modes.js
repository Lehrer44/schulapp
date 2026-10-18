(function(root){
 const labels={classic:'Klassisch',buzzer:'Buzzer',speed:'Schnellantwort'};
 function normalise(mode){return Object.hasOwn(labels,mode)?mode:'classic';}
 function options(mode,inherit=false){return (inherit?'<option value="inherit"'+(!Object.hasOwn(labels,mode)?' selected':'')+'>Standard übernehmen</option>':'')+Object.entries(labels).map(([value,label])=>'<option value="'+value+'"'+(value===mode?' selected':'')+'>'+label+'</option>').join('');}
 root.QuizModes={labels,normalise,options,label:mode=>labels[normalise(mode)]};
})(window);

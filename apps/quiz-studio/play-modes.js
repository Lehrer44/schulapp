(function(root){
 const labels={classic:'Klassisch',buzzer:'Buzzer',speed:'Schnellantwort'};
 function normalise(mode){return Object.hasOwn(labels,mode)?mode:'classic';}
 function options(mode){return Object.entries(labels).map(([value,label])=>'<option value="'+value+'"'+(value===normalise(mode)?' selected':'')+'>'+label+'</option>').join('');}
 root.QuizModes={normalise,options};
})(window);


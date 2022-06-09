window.addEventListener('load', function() {

	const title = document.getElementById('title');
	const progressBar = document.getElementById('progress-bar');

	ipcRenderer.on('status-label-update', function(event, label) {

		title.innerHTML = label;

	});

	ipcRenderer.on('status-progress-update', function(event, progress) {

		progressBar.style.width = Math.min(100.00, parseFloat(progress).toFixed(2)) + '%';
        
	});

});
const app = require("./app");
const https = require("https");
const fs = require("fs");

const PORT = 80;
const PORTHTTPS = 443;

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

/*https
	.createServer(
		// Provide the private and public key to the server by reading each
		// file's content with the readFileSync() method.
		{
			key: fs.readFileSync("filipedasilva.co.uk.key"),
			cert: fs.readFileSync("filipedasilva_co_uk.crt"),
		},
		app
	)
	.listen(PORTHTTPS, () => {
		console.log("https server listening on port 443");
	});*/

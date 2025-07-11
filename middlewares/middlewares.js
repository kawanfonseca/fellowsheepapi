const fs = require("fs");

function logger(req, res, next){

    const date = new Date();
    const logger = {
      method: req.method,
      url: req.url,
      time: date.toDateString() + " - " + date.toTimeString(),
    };
    fs.promises.appendFile("log.txt", JSON.stringify(logger, null, 2));
    next();
  };

  module.exports = logger;
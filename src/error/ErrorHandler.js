// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  const { status, message, errors } = err; // we create a custom exception for each of our error cases, each one will have status,message and optionally errors
  let validationErrors;
  if (errors) { // if we do have errors we send them as validationErrors, we also translate each error to the requested language using the req.t method
    validationErrors = {};
    errors.forEach((error) => {
      validationErrors[error.param] = req.t(error.msg);
    });
  }

  res.status(status).send({
    path: req.originalUrl, // requested path
    timestamp: new Date().getTime(), // current time
    message: req.t(message), // the translated message
    validationErrors, // validation errors if available
  });
};

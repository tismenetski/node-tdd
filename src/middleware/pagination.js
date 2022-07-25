const pagination = (req,res,next) => {
    const pageAsNumber = Number.parseInt(req.query.page);
    const sizeAsNumber = Number.parseInt(req.query.size); // we want to make sure that our param is of type number
    let page = Number.isNaN(pageAsNumber) ? 0 : pageAsNumber; // if not of type number just
    let size = Number.isNaN(sizeAsNumber) ? 10 : sizeAsNumber;
    if (page < 0) {
        page = 0;
    }
    if (size <= 0 || size > 10) {
        size = 10;
    }
    req.pagination = {size,page};
    next();
}

module.exports = pagination;
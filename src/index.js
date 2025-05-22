const express = require('express');
const cors = require('cors');
const PORT = 5000

const app = express();
app.use(cors());
cors() // bu qator ochirib tashisila
express() // buniyam 


app.listen(PORT , () => {
    console.log(`================================================================`);
    console.log(`Server is running on port ${PORT}`);
    console.log(`Server created by Sardor Xojimurodov`); 
    console.log(`================================================================`);
})
const express = require('express');
const cors = require('cors')
const dotevn = require("dotenv");
const mongoose = require('mongoose');

const crypto = require('crypto');
const {GridFsStorage} = require('multer-gridfs-storage');
const multer = require('multer');
const Grid = require('gridfs-stream');

const connectDB = require('./services/db');
const path = require('path');

dotevn.config();
const PORT = process.env.PORT || 5000;

const app = express()

const init = async () => {
app.use(express.json());
app.use(express.urlencoded({extended: false}));

app.use(cors());

await connectDB();

const conn = mongoose.connection

const gfs = await Grid(conn.db,mongoose.mongo )
gfs.collection('media')

const storage = await new GridFsStorage({
    
    db: conn.db,
    file: (req, file)=>{
       return new Promise((resolve, reject)=>{
           crypto.randomBytes(16, (err, buf)=>{
            if(err){
                return reject(err);
            }
            const filename = buf.toString('hex') + path.extname(file.originalname);
            const fileInfo = {
                filename,
                bucketName: 'media'
            };
            return resolve(fileInfo)
           });
       });

    }
});
const upload = multer({storage});

app.post('/upload', upload.single('file'), (req, res)=>{
    res.json(req.file)
});

app.get('/files', async(req, res)=>{
   try{
        const files = await gfs.files.find().toArray()
        res.json(files)
    }catch(err){
        res.status(400).send(err)
    }
});

app.get('/read/:filename', async(req,res)=>{
    const {filename} = req.params
    try{
        const readstream = await gfs.createReadStream({filename})
        readstream.pipe(res)
    }catch(err){
        res.status(400).send(err)
    }
});

app.delete('/delete/:filename', async(req, res)=>{
    const{filename} = req.params
    try{
        await gfs.files.remove({filename})
        res.status(200).end()
    }catch(err){
        res.status(400).send(err)
    }
})

}
init()

app.listen(PORT, ()=>{
    console.log(`The server is running on: http://localhost:${PORT}`)
})


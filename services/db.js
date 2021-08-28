const mongoose = require("mongoose");


const connectDB = async () => {
  try{
      await mongoose.connect(process.env.MONGO_URI, {
        useNewUrlParser: true,
        useFindAndModify: false,
        useUnifiedTopology: true,
        useCreateIndex: true 
      })
  }catch(err){
      process.exit(1)
  }
}

module.exports= connectDB
import 'dotenv/config';
import express from 'express';
import router from './src/routes/generate.js';
import morgan from 'morgan';

const app = express();
const PORT = process.env.PORT || 3000 ;


app.use(express.json());
app.use(morgan("dev"));

app.use('/', router);


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});




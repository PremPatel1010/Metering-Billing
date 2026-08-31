import pkg from 'pg';
const { Pool } = pkg;


const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.query('SELECT NOW()' , (err, res) => {
  if(err){
    console.error("Database connection failed: ", err.stack);
  } else {
    console.log("Connection successfully at", res.rows[0].now);
  }
});



export default pool;
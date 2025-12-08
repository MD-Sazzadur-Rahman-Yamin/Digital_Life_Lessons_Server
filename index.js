require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const stripe = require("stripe")(process.env.stripe_secret);

const app = express();
const port = process.env.PORT || 3333;

// middlewares
app.use(cors());
app.use(express.json());

// MongoDB connection string
const uri = `mongodb+srv://${process.env.mongodb_user}:${process.env.mongodb_pass}@cluster0.zzj1wzu.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    //Database
    const db = client.db("Digital_Life_Lessons_DB");
    //collections
    const users_coll = db.collection("users");

    //users APIs
    app.post("/users/sync", async (req, res) => {
      //add user
      try {
        const user = req.body;
        user.role = "user";
        user.createdAt = new Date();
        user.isPremium = false;

        const email = user.email;
        const isUserExist = await users_coll.findOne({ email });
        if (isUserExist) {
          return res.send({ message: "User Exist" });
        }
        const result = await users_coll.insertOne(user);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    //payments api
    //stripe
    app.post(
      "/payments/create-checkout-session/digital-life-lessons-premium",
      async (req, res) => {
        try {
          // body must contain user customer_email, metadata(object)(it can be anything)
          const paymentInfo = req.body;
          const session = await stripe.checkout.sessions.create({
            line_items: [
              {
                price_data: {
                  currency: "BDT",
                  unit_amount: 150000,
                  product_data: {
                    name: "Digital Life Lessons Premium",
                  },
                },
                quantity: 1,
              },
            ],
            metadata: paymentInfo.metadata,
            customer_email: paymentInfo.customer_email,
            mode: "payment",
            success_url: `${process.env.client_domain}?/upgrade-successful`,
            cancel_url: `${process.env.client_domain}?/upgrade-failed`,
          });
          res.send({ url: session.url });
        } catch (error) {
          res.status(500).send({ error: error.message });
        }
      }
    );

    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB!");
  } catch (error) {
    console.log("MongoDB Error:", error);
  }
}
run();

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

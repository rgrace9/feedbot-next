import * as dotenv from "dotenv";

dotenv.config();

const response = await fetch("https://openrouter.ai/api/v1/key", {
  method: "GET",
  headers: {
    Authorization: `Bearer ${process.env.OPEN_ROUTER_KEY}`,
  },
});

const { data } = await response.json();

console.log(
  `Credits remaining: $${data.limit_remaining.toFixed(2)} of $${data.limit}`,
);

console.log(data);

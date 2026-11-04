from fastapi import Depends, FastAPI
from sqlalchemy.orm import Session

from database import get_db
from scraper import seed_database

app = FastAPI()


@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI"}


@app.post("/api/seed")
def trigger_seed(db: Session = Depends(get_db)):
    """Trigger the scraper and database seeding pipeline on demand."""
    result = seed_database(db=db)
    return result

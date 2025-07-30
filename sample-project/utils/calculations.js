// sample-project/utils/calculations.js
/**
 * A simple function to add two numbers.
 * @param {number} a - The first number.
 * @param {number} b - The second number.
 * @returns {number} - The sum of a and b.
 */
export const add = (a, b) => {
    return a + b;
  };
  
  class Calculator {
    constructor() {
      this.result = 0;
    }
  
    /**
     * Multiplies the current result by a number.
     * @param {number} n - The number to multiply by.
     */
    multiply(n) {
      if (this.result === 0) {
        this.result = n;
      } else {
        this.result *= n;
      }
    }
  }
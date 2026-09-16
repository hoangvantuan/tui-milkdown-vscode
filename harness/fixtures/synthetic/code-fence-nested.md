# Nested Code Fences

Here is an ordinary code block:

```javascript
console.log("hello");
```

Here is a 4-backtick code block containing a nested 3-backtick block (Issue #92):

````markdown
```python
def greet(name):
    return f"Hello, {name}!"
```
````

Here is a 5-backtick code block containing nested 4-backtick and 3-backtick blocks:

`````markdown
````markdown
```bash
echo "deeply nested"
```
````
`````

Here is a code block containing inline backticks:

```javascript
const greeting = `Hello, ${name}!`;
const code = `\`inline\``;
```

Here is a code block containing tilde fences:

```text
~~~
tildes inside backtick fence
~~~
```

Here is a 4-backtick code block without language containing a 3-backtick block:

````
```
plain nested block
```
````